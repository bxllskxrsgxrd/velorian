import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from .errors import AppError
from .models import KnowledgeFilterDefinition, KnowledgeFilterOption, KnowledgeItem, KnowledgeItemFilterValue


def normalize_filter_value(value: str) -> str:
	"""Canonical normalization shared by filter names, options and aliases."""
	normalized = unicodedata.normalize("NFKC", value)
	return " ".join(normalized.casefold().replace("ё", "е").split())


def stable_filter_slug(value: str) -> str:
	normalized = normalize_filter_value(value)
	return re.sub(r"[^\w]+", "-", normalized, flags=re.UNICODE).strip("-")[:96]


@dataclass(frozen=True)
class CanonicalFilterGroup:
	filter_id: str
	filter_name: str
	option_ids: tuple[str, ...]
	option_values: tuple[str, ...]
	explicit: bool = True


def canonicalize_filter_groups(
	db: Session,
	user_id: str,
	groups: Iterable[tuple[str, Iterable[str]]],
	*,
	explicit_by_filter: dict[str, bool] | None = None,
) -> tuple[CanonicalFilterGroup, ...]:
	merged: dict[str, set[str]] = defaultdict(set)
	for filter_id, option_ids in groups:
		if not filter_id:
			continue
		merged[filter_id].update(option_id for option_id in option_ids if option_id)
	merged = {filter_id: option_ids for filter_id, option_ids in merged.items() if option_ids}
	if not merged:
		return ()

	definitions = {
		definition.id: definition
		for definition in db.scalars(select(KnowledgeFilterDefinition).where(
			KnowledgeFilterDefinition.id.in_(merged), KnowledgeFilterDefinition.user_id == user_id,
		))
	}
	if len(definitions) != len(merged):
		raise AppError(422, "INVALID_FILTER_OPTION", "Фильтр недоступен текущему пользователю")

	all_option_ids = {option_id for option_ids in merged.values() for option_id in option_ids}
	options = {
		option.id: option
		for option in db.scalars(select(KnowledgeFilterOption).where(KnowledgeFilterOption.id.in_(all_option_ids)))
	}
	if len(options) != len(all_option_ids):
		raise AppError(422, "INVALID_FILTER_OPTION", "Выбранное значение фильтра недоступно")

	canonical: list[CanonicalFilterGroup] = []
	for filter_id in sorted(merged):
		option_ids = tuple(sorted(merged[filter_id]))
		if any(options[option_id].filter_definition_id != filter_id for option_id in option_ids):
			raise AppError(422, "INVALID_FILTER_OPTION", "Значение не принадлежит указанному фильтру")
		canonical.append(CanonicalFilterGroup(
			filter_id=filter_id,
			filter_name=definitions[filter_id].name,
			option_ids=option_ids,
			option_values=tuple(options[option_id].value for option_id in option_ids),
			explicit=(explicit_by_filter or {}).get(filter_id, True),
		))
	return tuple(canonical)


def canonicalize_option_ids(
	db: Session,
	user_id: str,
	option_ids: Iterable[str],
	*,
	explicit: bool = True,
) -> tuple[CanonicalFilterGroup, ...]:
	unique_ids = sorted(set(option_id for option_id in option_ids if option_id))
	if not unique_ids:
		return ()
	options = list(db.scalars(select(KnowledgeFilterOption).join(KnowledgeFilterDefinition).where(
		KnowledgeFilterOption.id.in_(unique_ids), KnowledgeFilterDefinition.user_id == user_id,
	)))
	if len(options) != len(unique_ids):
		raise AppError(422, "INVALID_FILTER_OPTION", "Выбранное значение фильтра недоступно")
	grouped: dict[str, list[str]] = defaultdict(list)
	for option in options:
		grouped[option.filter_definition_id].append(option.id)
	return canonicalize_filter_groups(
		db, user_id, grouped.items(),
		explicit_by_filter={filter_id: explicit for filter_id in grouped},
	)


def apply_filter_groups(statement: Select, groups: Iterable[CanonicalFilterGroup]) -> Select:
	for group in groups:
		statement = statement.where(KnowledgeItem.filter_values.any(and_(
			KnowledgeItemFilterValue.filter_definition_id == group.filter_id,
			KnowledgeItemFilterValue.filter_option_id.in_(group.option_ids),
		)))
	return statement


def progressive_candidate_counts(
	db: Session,
	base_conditions: Iterable,
	groups: Iterable[CanonicalFilterGroup],
) -> tuple[tuple[str, int], ...]:
	statement = select(func.count()).select_from(KnowledgeItem).where(*base_conditions)
	counts: list[tuple[str, int]] = []
	for group in groups:
		statement = statement.where(KnowledgeItem.filter_values.any(and_(
			KnowledgeItemFilterValue.filter_definition_id == group.filter_id,
			KnowledgeItemFilterValue.filter_option_id.in_(group.option_ids),
		)))
		counts.append((group.filter_id, db.scalar(statement) or 0))
	return tuple(counts)
