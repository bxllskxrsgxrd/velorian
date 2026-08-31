import asyncio
import base64
import binascii
import hashlib
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, asc, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .errors import AppError
from .file_processing import extract_text, validate_file_name
from .knowledge_filters import (
	CanonicalFilterGroup, apply_filter_groups, canonicalize_filter_groups, canonicalize_option_ids,
	normalize_filter_value, stable_filter_slug,
)
from .knowledge_retrieval import KnowledgeRetrievalResult, KnowledgeSearchOptions, knowledge_retrieval_service
from .models import (
	Attachment, Conversation, KnowledgeApproach, KnowledgeFilterDefinition, KnowledgeFilterOption,
	KnowledgeFilterOptionAlias, KnowledgeItem, KnowledgeItemFilterValue, Message, MessageRating, User, new_id, utc_now,
)
from .storage import build_storage_key, get_file_storage


router = APIRouter(prefix=f"{settings.api_prefix}/knowledge", tags=["knowledge"])
logger = logging.getLogger("velorian")
RatingValue = Annotated[int, Field(strict=True, ge=1, le=5)]


class KnowledgeFilterSelectionPayload(BaseModel):
	filter_id: str = Field(min_length=1, max_length=36)
	option_ids: list[str] = Field(default_factory=list, max_length=50)


class KnowledgeCreatePayload(BaseModel):
	title: str = Field(min_length=1, max_length=255)
	content: str = Field(min_length=1, max_length=2_000_000)
	is_active: bool = True
	rating: RatingValue | None = None
	approach_id: str | None = Field(default=None, max_length=36)
	filter_option_ids: list[str] = Field(default_factory=list, max_length=50)
	filters: list[KnowledgeFilterSelectionPayload] = Field(default_factory=list, max_length=50)


class KnowledgeUpdatePayload(BaseModel):
	title: str | None = Field(default=None, min_length=1, max_length=255)
	content: str | None = Field(default=None, min_length=1, max_length=2_000_000)
	is_active: bool | None = None
	rating: RatingValue | None = None
	approach_id: str | None = Field(default=None, max_length=36)
	filter_option_ids: list[str] | None = Field(default=None, max_length=50)
	filters: list[KnowledgeFilterSelectionPayload] | None = Field(default=None, max_length=50)


class ApproachPayload(BaseModel):
	name: str = Field(min_length=1, max_length=80)


class FilterDefinitionPayload(BaseModel):
	name: str = Field(min_length=1, max_length=80)


class FilterOptionPayload(BaseModel):
	value: str = Field(min_length=1, max_length=120)


class FilterAliasPayload(BaseModel):
	value: str = Field(min_length=1, max_length=120)


class GeneratedFileKnowledgePayload(BaseModel):
	title: str = Field(min_length=1, max_length=255)
	is_active: bool = True
	rating: RatingValue | None = None
	filter_option_ids: list[str] = Field(default_factory=list, max_length=50)
	filters: list[KnowledgeFilterSelectionPayload] = Field(default_factory=list, max_length=50)


DEFAULT_APPROACHES = (("Интервью", "интервью"), ("Шоу", "шоу"))
APPROACH_FILTER_SLUG = "podhod"


def normalize_approach_slug(value: str) -> str:
	return stable_filter_slug(value)


def _markdown_filename(title: str, item_id: str) -> str:
	base = normalize_approach_slug(title)[:72] or "knowledge"
	return f"{base}-{item_id[:8]}.md"


def filter_alias_payload(alias: KnowledgeFilterOptionAlias) -> dict:
	return {"id": alias.id, "value": alias.value, "normalizedValue": alias.normalized_value}


def filter_option_payload(option: KnowledgeFilterOption, item_count: int = 0) -> dict:
	return {
		"id": option.id, "value": option.value, "normalizedValue": option.normalized_value,
		"itemCount": item_count,
		"aliases": [filter_alias_payload(alias) for alias in sorted(option.aliases, key=lambda item: item.value.casefold())],
	}


def filter_definition_payload(
	definition: KnowledgeFilterDefinition,
	option_counts: dict[str, int] | None = None,
	definition_count: int = 0,
) -> dict:
	return {
		"id": definition.id, "name": definition.name, "normalizedName": definition.normalized_name,
		"slug": definition.slug, "type": definition.type,
		"isSystem": definition.is_system,
		"itemCount": definition_count,
		"options": [filter_option_payload(option, (option_counts or {}).get(option.id, 0)) for option in sorted(definition.options, key=lambda item: item.value.casefold())],
		"createdAt": definition.created_at.isoformat(), "updatedAt": definition.updated_at.isoformat(),
	}


def item_filter_payload(value: KnowledgeItemFilterValue) -> dict:
	return {
		"filterId": value.filter_definition_id, "filterName": value.definition.name,
		"filterSlug": value.definition.slug, "optionId": value.filter_option_id, "value": value.option.value,
	}


def approach_payload(approach: KnowledgeApproach) -> dict:
	return {
		"id": approach.id,
		"name": approach.name,
		"slug": approach.slug,
		"createdAt": approach.created_at.isoformat(),
		"updatedAt": approach.updated_at.isoformat(),
	}


def ensure_default_approaches(db: Session, user_id: str) -> None:
	existing = set(db.scalars(select(KnowledgeApproach.slug).where(KnowledgeApproach.user_id == user_id)))
	for name, slug in DEFAULT_APPROACHES:
		if slug not in existing:
			db.add(KnowledgeApproach(user_id=user_id, name=name, slug=slug))
	definition = db.scalar(select(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user_id, KnowledgeFilterDefinition.slug == APPROACH_FILTER_SLUG,
	))
	if definition is None:
		definition = KnowledgeFilterDefinition(
			user_id=user_id, name="Подход", normalized_name=normalize_filter_value("Подход"),
			slug=APPROACH_FILTER_SLUG, type="multi_select", is_system=True,
		)
		db.add(definition)
		db.flush()
	existing_options = {option.normalized_value for option in definition.options}
	for name, normalized in DEFAULT_APPROACHES:
		if normalized not in existing_options:
			db.add(KnowledgeFilterOption(
				filter_definition_id=definition.id, value=name, normalized_value=normalized,
			))


def owned_approach(db: Session, approach_id: str, user_id: str) -> KnowledgeApproach:
	approach = db.scalar(select(KnowledgeApproach).where(
		KnowledgeApproach.id == approach_id,
		KnowledgeApproach.user_id == user_id,
	))
	if approach is None:
		raise AppError(404, "KNOWLEDGE_APPROACH_NOT_FOUND", "Подход не найден")
	return approach


def optional_owned_approach(db: Session, approach_id: str | None, user_id: str) -> KnowledgeApproach | None:
	return owned_approach(db, approach_id, user_id) if approach_id else None


def _knowledge_search_condition(db: Session, raw_term: str):
	term = " ".join(raw_term.casefold().replace("ё", "е").split())
	fields = (KnowledgeItem.title, KnowledgeItem.content, KnowledgeItem.original_filename)
	if db.bind is not None and db.bind.dialect.name == "sqlite":
		return or_(*(func.casefold(field).contains(term, autoescape=True) for field in fields))
	return or_(*(field.icontains(raw_term, autoescape=True) for field in fields))


def knowledge_payload(item: KnowledgeItem) -> dict:
	filters = [item_filter_payload(value) for value in item.filter_values]
	approach_filter = next((value for value in filters if value["filterSlug"] == APPROACH_FILTER_SLUG), None)
	return {
		"id": item.id,
		"sourceType": item.source_type,
		"sourceMessageId": item.source_message_ref_id or item.source_message_id,
		"sourceFileId": item.source_file_id,
		"title": item.title,
		"content": item.content,
		"mimeType": item.mime_type,
		"originalFilename": item.original_filename,
		"rating": item.rating,
		"approach": approach_payload(item.approach) if item.approach else (
			{"id": approach_filter["optionId"], "name": approach_filter["value"], "slug": normalize_approach_slug(approach_filter["value"])}
			if approach_filter else None
		),
		"filters": filters,
		"isActive": item.is_active,
		"metadata": item.item_metadata or {},
		"createdAt": item.created_at.isoformat(),
		"updatedAt": item.updated_at.isoformat(),
		"downloadUrl": f"{settings.api_prefix}/knowledge/{item.id}/file",
	}


def owned_filter_definition(db: Session, definition_id: str, user_id: str) -> KnowledgeFilterDefinition:
	definition = db.scalar(select(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.id == definition_id, KnowledgeFilterDefinition.user_id == user_id,
	))
	if definition is None:
		raise AppError(404, "KNOWLEDGE_FILTER_NOT_FOUND", "Фильтр не найден")
	return definition


def _owned_filter_options(db: Session, option_ids: list[str], user_id: str) -> list[KnowledgeFilterOption]:
	groups = canonicalize_option_ids(db, user_id, option_ids)
	canonical_ids = [option_id for group in groups for option_id in group.option_ids]
	return list(db.scalars(select(KnowledgeFilterOption).where(KnowledgeFilterOption.id.in_(canonical_ids)))) if canonical_ids else []


def _canonical_payload_groups(
	db: Session,
	user_id: str,
	option_ids: list[str] | None,
	groups: list[KnowledgeFilterSelectionPayload] | None,
) -> tuple[CanonicalFilterGroup, ...]:
	raw_groups = [(group.filter_id, group.option_ids) for group in (groups or [])]
	legacy = canonicalize_option_ids(db, user_id, option_ids or [])
	raw_groups.extend((group.filter_id, group.option_ids) for group in legacy)
	return canonicalize_filter_groups(db, user_id, raw_groups)


def _set_item_filters(
	db: Session,
	item: KnowledgeItem,
	option_ids: list[str],
	user_id: str,
	groups: list[KnowledgeFilterSelectionPayload] | None = None,
) -> None:
	canonical = _canonical_payload_groups(db, user_id, option_ids, groups)
	next_pairs = {
		(group.filter_id, option_id)
		for group in canonical
		for option_id in group.option_ids
	}
	existing = {(value.filter_definition_id, value.filter_option_id): value for value in item.filter_values}
	for pair, value in existing.items():
		if pair not in next_pairs:
			item.filter_values.remove(value)
	for filter_id, option_id in next_pairs - existing.keys():
		item.filter_values.append(KnowledgeItemFilterValue(
			filter_definition_id=filter_id, filter_option_id=option_id,
		))


def _filter_usage_counts(db: Session, user_id: str) -> tuple[dict[str, int], dict[str, int]]:
	option_counts = dict(db.execute(
		select(KnowledgeItemFilterValue.filter_option_id, func.count(KnowledgeItemFilterValue.knowledge_item_id))
		.join(KnowledgeItem, KnowledgeItem.id == KnowledgeItemFilterValue.knowledge_item_id)
		.where(KnowledgeItem.user_id == user_id)
		.group_by(KnowledgeItemFilterValue.filter_option_id)
	).all())
	definition_counts = dict(db.execute(
		select(KnowledgeItemFilterValue.filter_definition_id, func.count(func.distinct(KnowledgeItemFilterValue.knowledge_item_id)))
		.join(KnowledgeItem, KnowledgeItem.id == KnowledgeItemFilterValue.knowledge_item_id)
		.where(KnowledgeItem.user_id == user_id)
		.group_by(KnowledgeItemFilterValue.filter_definition_id)
	).all())
	return option_counts, definition_counts


def _with_legacy_approach_option(db: Session, user_id: str, option_ids: list[str], approach: KnowledgeApproach | None) -> list[str]:
	if approach is None:
		return option_ids
	option = db.scalar(select(KnowledgeFilterOption).join(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user_id,
		KnowledgeFilterDefinition.slug == APPROACH_FILTER_SLUG,
		KnowledgeFilterOption.normalized_value.in_((approach.slug, normalize_filter_value(approach.name))),
	))
	return [*option_ids, option.id] if option and option.id not in option_ids else option_ids


def _parse_filter_option_ids(raw_value: str) -> list[str]:
	try:
		value = json.loads(raw_value or "[]")
	except json.JSONDecodeError as error:
		raise AppError(422, "INVALID_KNOWLEDGE_FILTERS", "Некорректный список фильтров") from error
	if not isinstance(value, list) or any(not isinstance(item, str) or len(item) > 36 for item in value):
		raise AppError(422, "INVALID_KNOWLEDGE_FILTERS", "Некорректный список фильтров")
	return value


def owned_knowledge_item(db: Session, item_id: str, user_id: str) -> KnowledgeItem:
	item = db.scalar(select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.user_id == user_id))
	if item is None:
		raise AppError(404, "KNOWLEDGE_NOT_FOUND", "Элемент базы знаний не найден")
	return item


@router.get("/approaches")
def list_approaches(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	ensure_default_approaches(db, user.id)
	db.commit()
	items = list(db.scalars(select(KnowledgeApproach).where(
		KnowledgeApproach.user_id == user.id,
	).order_by(KnowledgeApproach.name.asc())))
	return {"items": [approach_payload(item) for item in items]}


@router.post("/approaches")
def create_approach(payload: ApproachPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	ensure_default_approaches(db, user.id)
	db.flush()
	name = " ".join(payload.name.split())
	slug = normalize_approach_slug(name)
	if not slug:
		raise AppError(422, "INVALID_APPROACH_NAME", "Введите название подхода")
	item = KnowledgeApproach(user_id=user.id, name=name, slug=slug)
	db.add(item)
	definition = db.scalar(select(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user.id, KnowledgeFilterDefinition.slug == APPROACH_FILTER_SLUG,
	))
	if definition is not None and not any(option.normalized_value == normalize_filter_value(name) for option in definition.options):
		db.add(KnowledgeFilterOption(
			filter_definition_id=definition.id, value=name, normalized_value=normalize_filter_value(name),
		))
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_APPROACH_EXISTS", "Подход с таким названием уже существует") from error
	return {"item": approach_payload(item)}


@router.patch("/approaches/{approach_id}")
def rename_approach(approach_id: str, payload: ApproachPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_approach(db, approach_id, user.id)
	legacy_slug = item.slug
	legacy_name = item.name
	item.name = " ".join(payload.name.split())
	item.slug = normalize_approach_slug(item.name)
	if not item.slug:
		raise AppError(422, "INVALID_APPROACH_NAME", "Введите название подхода")
	option = db.scalar(select(KnowledgeFilterOption).join(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user.id, KnowledgeFilterDefinition.slug == APPROACH_FILTER_SLUG,
		KnowledgeFilterOption.normalized_value.in_((legacy_slug, normalize_filter_value(legacy_name))),
	))
	if option is not None:
		option.value = item.name
		option.normalized_value = normalize_filter_value(item.name)
		option.updated_at = utc_now()
	item.updated_at = utc_now()
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_APPROACH_EXISTS", "Подход с таким названием уже существует") from error
	return {"item": approach_payload(item)}


@router.delete("/approaches/{approach_id}", status_code=204)
def delete_approach(approach_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_approach(db, approach_id, user.id)
	option = db.scalar(select(KnowledgeFilterOption).join(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user.id, KnowledgeFilterDefinition.slug == APPROACH_FILTER_SLUG,
		KnowledgeFilterOption.normalized_value.in_((item.slug, normalize_filter_value(item.name))),
	))
	db.execute(update(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.approach_id == item.id,
	).values(approach_id=None, updated_at=utc_now()))
	if option is not None:
		db.delete(option)
	db.delete(item)
	db.commit()
	return Response(status_code=204)


@router.get("/filters")
def list_filter_definitions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	ensure_default_approaches(db, user.id)
	db.commit()
	option_counts, definition_counts = _filter_usage_counts(db, user.id)
	definitions = list(db.scalars(select(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user.id,
	).order_by(KnowledgeFilterDefinition.is_system.desc(), KnowledgeFilterDefinition.name.asc())))
	return {"items": [
		filter_definition_payload(definition, option_counts, definition_counts.get(definition.id, 0))
		for definition in definitions
	]}


@router.post("/filters")
def create_filter_definition(payload: FilterDefinitionPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	name = " ".join(payload.name.split())
	slug = normalize_approach_slug(name)
	if not slug:
		raise AppError(422, "INVALID_KNOWLEDGE_FILTER_NAME", "Введите название фильтра")
	definition = KnowledgeFilterDefinition(
		user_id=user.id, name=name, normalized_name=normalize_filter_value(name),
		slug=slug, type="multi_select",
	)
	db.add(definition)
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "FILTER_ALREADY_EXISTS", "Фильтр с таким названием уже существует.") from error
	return {"item": filter_definition_payload(definition)}


@router.patch("/filters/{definition_id}")
def rename_filter_definition(definition_id: str, payload: FilterDefinitionPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	definition = owned_filter_definition(db, definition_id, user.id)
	definition.name = " ".join(payload.name.split())
	definition.normalized_name = normalize_filter_value(definition.name)
	if not definition.normalized_name:
		raise AppError(422, "INVALID_KNOWLEDGE_FILTER_NAME", "Введите название фильтра")
	definition.updated_at = utc_now()
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "FILTER_ALREADY_EXISTS", "Фильтр с таким названием уже существует.") from error
	option_counts, definition_counts = _filter_usage_counts(db, user.id)
	return {"item": filter_definition_payload(definition, option_counts, definition_counts.get(definition.id, 0))}


@router.delete("/filters/{definition_id}", status_code=204)
def delete_filter_definition(definition_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	definition = owned_filter_definition(db, definition_id, user.id)
	if definition.is_system:
		raise AppError(422, "SYSTEM_FILTER_CANNOT_BE_DELETED", "Системный фильтр удалить нельзя")
	db.delete(definition)
	db.commit()
	return Response(status_code=204)


@router.post("/filters/{definition_id}/options")
def create_filter_option(definition_id: str, payload: FilterOptionPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	definition = owned_filter_definition(db, definition_id, user.id)
	value = " ".join(payload.value.split())
	normalized = normalize_filter_value(value)
	if not normalized:
		raise AppError(422, "INVALID_KNOWLEDGE_FILTER_OPTION", "Введите значение фильтра")
	option = KnowledgeFilterOption(filter_definition_id=definition.id, value=value, normalized_value=normalized)
	db.add(option)
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "FILTER_OPTION_ALREADY_EXISTS", "Такое значение уже существует в этом фильтре.") from error
	return {"item": filter_option_payload(option)}


@router.patch("/filters/{definition_id}/options/{option_id}")
def rename_filter_option(definition_id: str, option_id: str, payload: FilterOptionPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	definition = owned_filter_definition(db, definition_id, user.id)
	option = db.scalar(select(KnowledgeFilterOption).where(
		KnowledgeFilterOption.id == option_id, KnowledgeFilterOption.filter_definition_id == definition.id,
	))
	if option is None:
		raise AppError(404, "KNOWLEDGE_FILTER_OPTION_NOT_FOUND", "Значение фильтра не найдено")
	option.value = " ".join(payload.value.split())
	option.normalized_value = normalize_filter_value(option.value)
	if not option.normalized_value:
		raise AppError(422, "INVALID_KNOWLEDGE_FILTER_OPTION", "Введите значение фильтра")
	option.updated_at = utc_now()
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "FILTER_OPTION_ALREADY_EXISTS", "Такое значение уже существует в этом фильтре.") from error
	option_counts, _ = _filter_usage_counts(db, user.id)
	return {"item": filter_option_payload(option, option_counts.get(option.id, 0))}


@router.delete("/filters/{definition_id}/options/{option_id}", status_code=204)
def delete_filter_option(definition_id: str, option_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	definition = owned_filter_definition(db, definition_id, user.id)
	option = db.scalar(select(KnowledgeFilterOption).where(
		KnowledgeFilterOption.id == option_id, KnowledgeFilterOption.filter_definition_id == definition.id,
	))
	if option is None:
		raise AppError(404, "KNOWLEDGE_FILTER_OPTION_NOT_FOUND", "Значение фильтра не найдено")
	db.delete(option)
	db.commit()
	return Response(status_code=204)


@router.post("/filters/{definition_id}/options/{option_id}/aliases")
def create_filter_option_alias(
	definition_id: str,
	option_id: str,
	payload: FilterAliasPayload,
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	definition = owned_filter_definition(db, definition_id, user.id)
	option = db.scalar(select(KnowledgeFilterOption).where(
		KnowledgeFilterOption.id == option_id, KnowledgeFilterOption.filter_definition_id == definition.id,
	))
	if option is None:
		raise AppError(404, "KNOWLEDGE_FILTER_OPTION_NOT_FOUND", "Значение фильтра не найдено")
	value = " ".join(payload.value.split())
	normalized = normalize_filter_value(value)
	if not normalized:
		raise AppError(422, "INVALID_FILTER_OPTION_ALIAS", "Введите псевдоним")
	alias = KnowledgeFilterOptionAlias(filter_option_id=option.id, value=value, normalized_value=normalized)
	db.add(alias)
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "FILTER_OPTION_ALIAS_ALREADY_EXISTS", "Такой псевдоним уже существует для значения.") from error
	return {"item": filter_alias_payload(alias)}


@router.delete("/filters/{definition_id}/options/{option_id}/aliases/{alias_id}", status_code=204)
def delete_filter_option_alias(
	definition_id: str,
	option_id: str,
	alias_id: str,
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	definition = owned_filter_definition(db, definition_id, user.id)
	alias = db.scalar(select(KnowledgeFilterOptionAlias).join(KnowledgeFilterOption).where(
		KnowledgeFilterOptionAlias.id == alias_id,
		KnowledgeFilterOptionAlias.filter_option_id == option_id,
		KnowledgeFilterOption.filter_definition_id == definition.id,
	))
	if alias is None:
		raise AppError(404, "FILTER_OPTION_ALIAS_NOT_FOUND", "Псевдоним не найден")
	db.delete(alias)
	db.commit()
	return Response(status_code=204)


def _parse_filter_groups(raw_value: str | None) -> list[KnowledgeFilterSelectionPayload]:
	if not raw_value:
		return []
	try:
		value = json.loads(raw_value)
		if not isinstance(value, list):
			raise ValueError
		return [KnowledgeFilterSelectionPayload.model_validate(item) for item in value]
	except (ValueError, TypeError, json.JSONDecodeError) as error:
		raise AppError(422, "INVALID_FILTER_OPTION", "Некорректная комбинация фильтров") from error


@router.get("")
def list_knowledge_items(
	search: str = Query(default="", max_length=200),
	source_type: str | None = Query(default=None, max_length=32),
	approach_id: str | None = Query(default=None, max_length=36),
	filter_option_id: list[str] = Query(default=[]),
	filter_groups: str | None = Query(default=None, alias="filters", max_length=10_000),
	is_active: bool | None = None,
	min_rating: int | None = Query(default=None, ge=1, le=5),
	unrated: bool = False,
	sort: Literal["date_desc", "date_asc", "rating_desc", "rating_asc"] = "date_desc",
	limit: int = Query(default=20, ge=1, le=100),
	cursor: str | None = Query(default=None, max_length=512),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	statement = select(KnowledgeItem).where(KnowledgeItem.user_id == user.id)
	if search.strip():
		for term in search.split():
			statement = statement.where(_knowledge_search_condition(db, term))
	if source_type:
		statement = statement.where(KnowledgeItem.source_type == source_type)
	if approach_id:
		owned_approach(db, approach_id, user.id)
		statement = statement.where(KnowledgeItem.approach_id == approach_id)
	canonical_filters = _canonical_payload_groups(
		db, user.id, filter_option_id, _parse_filter_groups(filter_groups),
	)
	statement = apply_filter_groups(statement, canonical_filters)
	if is_active is not None:
		statement = statement.where(KnowledgeItem.is_active == is_active)
	if unrated:
		statement = statement.where(KnowledgeItem.rating.is_(None))
	elif min_rating is not None:
		statement = statement.where(KnowledgeItem.rating >= min_rating)
	order = {
		"date_desc": (desc(KnowledgeItem.updated_at), desc(KnowledgeItem.id)),
		"date_asc": (asc(KnowledgeItem.updated_at), asc(KnowledgeItem.id)),
		"rating_desc": (desc(KnowledgeItem.rating).nullslast(), desc(KnowledgeItem.updated_at), desc(KnowledgeItem.id)),
		"rating_asc": (asc(KnowledgeItem.rating).nullslast(), desc(KnowledgeItem.updated_at), desc(KnowledgeItem.id)),
	}[sort]
	if cursor:
		try:
			decoded = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode())
			if decoded["sort"] != sort:
				raise ValueError
			cursor_updated = datetime.fromisoformat(decoded["updated"])
			cursor_id = str(decoded["id"])
			cursor_rating = decoded.get("rating")
		except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
			raise AppError(422, "INVALID_CURSOR", "Некорректный курсор страницы")
		date_desc_after = or_(KnowledgeItem.updated_at < cursor_updated, and_(KnowledgeItem.updated_at == cursor_updated, KnowledgeItem.id < cursor_id))
		date_asc_after = or_(KnowledgeItem.updated_at > cursor_updated, and_(KnowledgeItem.updated_at == cursor_updated, KnowledgeItem.id > cursor_id))
		if sort == "date_desc":
			statement = statement.where(date_desc_after)
		elif sort == "date_asc":
			statement = statement.where(date_asc_after)
		elif cursor_rating is None:
			statement = statement.where(KnowledgeItem.rating.is_(None), date_desc_after)
		else:
			rating_after = KnowledgeItem.rating < cursor_rating if sort == "rating_desc" else KnowledgeItem.rating > cursor_rating
			statement = statement.where(or_(rating_after, KnowledgeItem.rating.is_(None), and_(KnowledgeItem.rating == cursor_rating, date_desc_after)))
	items = list(db.scalars(statement.order_by(*order).limit(limit + 1)))
	has_more = len(items) > limit
	items = items[:limit]
	if has_more:
		last = items[-1]
		cursor_payload = json.dumps({"sort": sort, "updated": last.updated_at.isoformat(), "id": last.id, "rating": last.rating}, separators=(",", ":"))
		next_cursor = base64.urlsafe_b64encode(cursor_payload.encode()).decode().rstrip("=")
	else:
		next_cursor = None
	return {"items": [knowledge_payload(item) for item in items], "pageInfo": {"nextCursor": next_cursor, "hasMore": has_more}}


@router.post("")
def create_manual_knowledge_item(payload: KnowledgeCreatePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	approach = optional_owned_approach(db, payload.approach_id, user.id)
	item = KnowledgeItem(
		id=new_id(),
		user_id=user.id,
		source_type="manual",
		title=payload.title.strip(),
		content=payload.content,
		mime_type="text/markdown",
		is_active=payload.is_active,
		rating=payload.rating,
		approach=approach,
	)
	item.original_filename = _markdown_filename(item.title, item.id)
	db.add(item)
	_set_item_filters(
		db, item, _with_legacy_approach_option(db, user.id, payload.filter_option_ids, approach),
		user.id, payload.filters,
	)
	db.commit()
	return {"item": knowledge_payload(item)}


@router.post("/files")
async def upload_knowledge_file(
	file: UploadFile = File(...),
	title: str = Form(default=""),
	rating: int | None = Form(default=None, ge=1, le=5),
	is_active: bool = Form(default=True),
	approach_id: str | None = Form(default=None, max_length=36),
	filter_option_ids: str = Form(default="[]"),
	filters: str = Form(default="[]"),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	approach = optional_owned_approach(db, approach_id, user.id)
	name = validate_file_name(file.filename or "Без имени")
	content = await file.read(settings.max_file_size + 1)
	await file.close()
	if len(content) > settings.max_file_size:
		raise AppError(413, "FILE_SIZE_LIMIT_EXCEEDED", f"Файл {name} превышает лимит", {
			"fileName": name, "actualSize": len(content), "maximumSize": settings.max_file_size,
		})
	extracted = extract_text(name, file.content_type or "application/octet-stream", content)
	if extracted.status not in {"ready", "empty", "ocr_unavailable"}:
		raise AppError(422, "FILE_PROCESSING_FAILED", f"Не удалось обработать файл {name}")
	checksum = hashlib.sha256(content).hexdigest()
	for existing in db.scalars(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_type == "uploaded_file")):
		if (existing.item_metadata or {}).get("sha256") == checksum:
			raise AppError(409, "KNOWLEDGE_DUPLICATE", "Такой файл уже добавлен в базу знаний")
	item = KnowledgeItem(
		user_id=user.id,
		source_type="uploaded_file",
		title=title.strip()[:255] or name,
		content=extracted.text,
		mime_type=file.content_type or "application/octet-stream",
		original_filename=name,
		rating=rating,
		is_active=is_active,
		approach=approach,
		item_metadata={"sha256": checksum, "extractionStatus": extracted.status},
	)
	db.add(item)
	_set_item_filters(
		db, item, _with_legacy_approach_option(db, user.id, _parse_filter_option_ids(filter_option_ids), approach),
		user.id, _parse_filter_groups(filters),
	)
	db.flush()
	storage_key = build_storage_key(user.id, "knowledge", item.id)
	storage = get_file_storage()
	try:
		await storage.save(storage_key, content, item.mime_type)
		item.storage_key = storage_key
		db.commit()
	except Exception:
		db.rollback()
		try:
			await storage.delete(storage_key)
		except Exception:
			logger.exception("Knowledge upload cleanup failed: storage_key=%s", storage_key)
		raise
	return {"item": knowledge_payload(item)}


@router.post("/messages/{message_id}")
def save_rated_message(message_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	message = db.scalar(
		select(Message)
		.join(Conversation, Conversation.id == Message.conversation_id)
		.where(Message.id == message_id, Message.role == "assistant", Conversation.user_id == user.id)
	)
	if message is None:
		raise AppError(404, "MESSAGE_NOT_FOUND", "Ответ не найден")
	rating = db.scalar(select(MessageRating).where(MessageRating.message_id == message.id, MessageRating.user_id == user.id))
	if rating is None or rating.score < settings.knowledge_rating_threshold:
		raise AppError(422, "RATING_TOO_LOW", f"Для сохранения нужна оценка не ниже {settings.knowledge_rating_threshold}")
	items: list[KnowledgeItem] = []
	message_item = db.scalar(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_message_id == message.id))
	if message_item is None:
		message_item = KnowledgeItem(
			id=new_id(),
			user_id=user.id,
			source_type="rated_content",
			source_message_id=message.id,
			title=(message.content.strip().splitlines()[0][:255] or "Сохранённый ответ"),
			content=message.content,
			mime_type="text/markdown",
			rating=rating.score,
		)
		message_item.original_filename = _markdown_filename(message_item.title, message_item.id)
		db.add(message_item)
	else:
		message_item.content = message.content
		message_item.rating = rating.score
		message_item.is_active = True
		message_item.updated_at = utc_now()
	items.append(message_item)
	for attachment in message.attachments:
		file_item = db.scalar(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_file_id == attachment.id))
		if file_item is None:
			file_item = KnowledgeItem(
				user_id=user.id,
				source_type="uploaded_file",
				source_message_ref_id=message.id,
				source_file_id=attachment.id,
				title=attachment.name,
				content=attachment.extracted_text,
				mime_type=attachment.content_type,
				original_filename=attachment.name,
				rating=rating.score,
			)
			db.add(file_item)
		else:
			file_item.rating = rating.score
			file_item.is_active = True
		items.append(file_item)
	db.commit()
	return {"items": [knowledge_payload(item) for item in items]}


@router.post("/generated-files/{attachment_id}")
def save_generated_file(
	attachment_id: str,
	payload: GeneratedFileKnowledgePayload,
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	attachment = db.scalar(
		select(Attachment)
		.join(Conversation, Conversation.id == Attachment.conversation_id)
		.join(Message, Message.id == Attachment.message_id)
		.where(
			Attachment.id == attachment_id,
			Conversation.user_id == user.id,
			Message.role == "assistant",
			Attachment.extraction_status == "generated",
		)
	)
	if attachment is None:
		raise AppError(404, "GENERATED_FILE_NOT_FOUND", "Созданный агентом файл не найден")
	existing = db.scalar(select(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id, KnowledgeItem.source_file_id == attachment.id,
	))
	if existing is not None:
		raise AppError(409, "KNOWLEDGE_FILE_ALREADY_ADDED", "Файл уже находится в базе знаний", {
			"knowledgeItemId": existing.id,
		})
	item = KnowledgeItem(
		user_id=user.id,
		source_type="assistant_generated_file",
		source_message_ref_id=attachment.message_id,
		source_file_id=attachment.id,
		title=payload.title.strip(),
		content=attachment.extracted_text,
		mime_type=attachment.content_type,
		original_filename=attachment.name,
		rating=payload.rating,
		is_active=payload.is_active,
		item_metadata={"chatId": attachment.conversation_id, "source": "assistant_generated_file"},
	)
	db.add(item)
	_set_item_filters(db, item, payload.filter_option_ids, user.id, payload.filters)
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_FILE_ALREADY_ADDED", "Файл уже находится в базе знаний") from error
	return {"item": knowledge_payload(item)}


@router.get("/{item_id}")
def get_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	return {"item": knowledge_payload(owned_knowledge_item(db, item_id, user.id))}


@router.patch("/{item_id}")
def update_knowledge_item(item_id: str, payload: KnowledgeUpdatePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	if payload.title is not None:
		item.title = payload.title.strip()
		if item.source_type in {"manual", "rated_content", "assistant_message"}:
			item.original_filename = _markdown_filename(item.title, item.id)
	if payload.content is not None:
		item.content = payload.content
	if payload.is_active is not None:
		item.is_active = payload.is_active
	if "rating" in payload.model_fields_set:
		item.rating = payload.rating
	if "approach_id" in payload.model_fields_set:
		item.approach = optional_owned_approach(db, payload.approach_id, user.id)
		if payload.filter_option_ids is None:
			custom_option_ids = [
				value.filter_option_id for value in item.filter_values
				if value.definition.slug != APPROACH_FILTER_SLUG
			]
			_set_item_filters(db, item, _with_legacy_approach_option(db, user.id, custom_option_ids, item.approach), user.id)
	if payload.filter_option_ids is not None or payload.filters is not None:
		_set_item_filters(db, item, payload.filter_option_ids or [], user.id, payload.filters)
	item.updated_at = utc_now()
	db.commit()
	return {"item": knowledge_payload(item)}


@router.delete("/{item_id}", status_code=204)
async def delete_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	storage_path = Path(item.storage_path) if item.storage_path else None
	storage_key = item.storage_key
	storage = get_file_storage()
	file_backup: bytes | None = None
	file_removed = False
	try:
		if storage_key:
			try:
				file_backup = await storage.get(storage_key)
			except (FileNotFoundError, OSError):
				file_backup = None
			await storage.delete(storage_key)
			file_removed = True
		elif storage_path is not None and storage_path.exists():
			file_backup = await asyncio.to_thread(storage_path.read_bytes)
			await asyncio.to_thread(storage_path.unlink, missing_ok=True)
			file_removed = True
	except Exception as error:
		logger.exception("Knowledge file deletion failed; preserving database item: item_id=%s", item_id)
		raise AppError(503, "KNOWLEDGE_FILE_DELETE_FAILED", "Не удалось удалить файл. Запись сохранена, повторите попытку.") from error
	try:
		db.delete(item)
		db.commit()
	except Exception:
		db.rollback()
		if file_removed and file_backup is not None:
			try:
				if storage_key:
					await storage.save(storage_key, file_backup, item.mime_type)
				elif storage_path is not None:
					await asyncio.to_thread(storage_path.write_bytes, file_backup)
			except Exception:
				logger.critical("Knowledge file restore failed after database rollback: item_id=%s", item_id, exc_info=True)
		raise
	return Response(status_code=204)


@router.get("/{item_id}/file")
async def download_knowledge_file(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	storage_key: str | None = None
	legacy_path: Path | None = None
	if item.storage_key or item.storage_path:
		storage_key = item.storage_key
		legacy_path = Path(item.storage_path) if item.storage_path else None
		name = item.original_filename or item.title
	elif item.source_file_id:
		attachment = db.scalar(
			select(Attachment)
			.join(Conversation, Conversation.id == Attachment.conversation_id)
			.where(Attachment.id == item.source_file_id, Conversation.user_id == user.id)
		)
		if attachment is None:
			raise AppError(404, "ATTACHMENT_NOT_FOUND", "Исходный файл не найден")
		storage_key = attachment.storage_key
		legacy_path = Path(attachment.storage_path) if attachment.storage_path else None
		name = attachment.name
	else:
		name = item.original_filename or _markdown_filename(item.title, item.id)
		return Response(
			item.content.encode("utf-8"), media_type=item.mime_type,
			headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
		)
	try:
		content = await get_file_storage().get(storage_key) if storage_key else await asyncio.to_thread(legacy_path.read_bytes) if legacy_path else None
	except (FileNotFoundError, OSError):
		content = None
	if content is None:
		raise AppError(404, "ATTACHMENT_MISSING", "Файл отсутствует в хранилище")
	return Response(content, media_type=item.mime_type, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


def retrieve_knowledge(db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
	return knowledge_retrieval_service.search(db, user_id, options)


def list_knowledge(db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
	return knowledge_retrieval_service.list(db, user_id, options)
