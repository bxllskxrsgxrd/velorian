import hashlib
import json
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .config import settings
from .models import KnowledgeApproach, KnowledgeItem


logger = logging.getLogger("velorian")
KnowledgeIntent = Literal["list", "search"]
TOKEN_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)
STOP_WORDS = {
	"а", "в", "все", "всё", "дай", "для", "есть", "и", "из", "как", "какие", "какой", "мне", "моя", "моей",
	"на", "найди", "о", "по", "про", "с", "там", "тебе", "текст", "тексты", "ты", "у", "что", "это", "the", "a", "an", "and", "for", "in", "of", "to",
}
FILTER_KEYS = ("geo", "celebrity", "offer", "news_source")


def normalize_text(value: str) -> str:
	return " ".join(value.casefold().replace("ё", "е").split())


def search_terms(value: str) -> list[str]:
	return [term for term in TOKEN_PATTERN.findall(normalize_text(value)) if len(term) > 2 and term not in STOP_WORDS and not term.startswith("подход")]


def detect_knowledge_intent(query: str, *, explicit_search: bool) -> KnowledgeIntent:
	normalized = normalize_text(query)
	repository_reference = re.search(
		r"(?:\bбд\b|\bбаз(?:а|е|у|ы|ой)\b(?:\s+знан\w*)?|knowledge\s+base|сохран\w*\s+(?:данн\w*|материал\w*|запис\w*|документ\w*)|ячейк\w*)",
		normalized,
	)
	browse_language = re.search(
		r"(?:\bвсе\b|\bчто\b|\bкакие\b|\bсколько\b|вид\w*|доступ\w*|покаж\w*|перечисл\w*|содерж\w*|наход\w*|\bесть\b|ячейк\w*)",
		normalized,
	)
	generic_inventory = re.search(r"(?:данн\w*|материал\w*|запис\w*|документ\w*|ячейк\w*)", normalized)
	inventory_request = re.search(
		r"(?:\bвсе\b|доступ\w*|сохран\w*|вид\w*|покаж\w*|перечисл\w*|содерж\w*|наход\w*|\bсколько\b|ячейк\w*)",
		normalized,
	)
	if repository_reference and browse_language:
		return "list"
	if explicit_search and browse_language and generic_inventory and inventory_request:
		return "list"
	return "search"


@dataclass(frozen=True)
class KnowledgeSearchOptions:
	query: str
	limit: int = 4
	approach_id: str | None = None
	approach_name: str | None = None
	requested_approach: str | None = None
	approach_exists: bool | None = None
	approach_profile: dict[str, object] | None = None
	geo: str | None = None
	celebrity: str | None = None
	offer: str | None = None
	news_source: str | None = None

	@property
	def metadata_filters(self) -> dict[str, str]:
		return {
			key: value for key in FILTER_KEYS
			if isinstance(value := getattr(self, key), str) and value
		}


@dataclass(frozen=True)
class KnowledgeQueryResolution:
	intent: KnowledgeIntent
	options: KnowledgeSearchOptions


def _terms_equivalent(left: str, right: str) -> bool:
	if left == right:
		return True
	shared = min(len(left), len(right)) - 1
	return shared >= 5 and left[:shared] == right[:shared]


def _query_contains_metadata_value(query: str, value: str) -> bool:
	normalized_value = normalize_text(value)
	if re.search(rf"(?<!\w){re.escape(normalized_value)}(?!\w)", query):
		return True
	query_tokens = TOKEN_PATTERN.findall(query)
	return all(
		any(_terms_equivalent(value_token, query_token) for query_token in query_tokens)
		for value_token in TOKEN_PATTERN.findall(normalized_value)
	)


def _resolve_metadata_filters(db: Session, user_id: str, normalized_query: str) -> dict[str, str]:
	values: dict[str, set[str]] = {key: set() for key in FILTER_KEYS}
	for metadata in db.scalars(select(KnowledgeItem.item_metadata).where(
		KnowledgeItem.user_id == user_id,
		KnowledgeItem.deleted_at.is_(None),
	)):
		if not isinstance(metadata, dict):
			continue
		for key in FILTER_KEYS:
			value = metadata.get(key)
			if isinstance(value, str) and value.strip():
				values[key].add(value.strip())
	return {
		key: max(matches, key=len)
		for key, candidates in values.items()
		if (matches := [value for value in candidates if _query_contains_metadata_value(normalized_query, value)])
	}


def resolve_knowledge_query(db: Session, user_id: str, query: str, *, explicit_search: bool, limit: int = 4) -> KnowledgeQueryResolution:
	normalized_query = normalize_text(query)
	approaches = list(db.scalars(select(KnowledgeApproach).where(KnowledgeApproach.user_id == user_id)))
	matched = [item for item in approaches if re.search(rf"(?<!\w){re.escape(normalize_text(item.name))}(?!\w)", normalized_query)]
	approach = max(matched, key=lambda item: len(normalize_text(item.name))) if matched else None
	# Only the singular forms denote a named approach. The plural in questions such
	# as "Какие подходы есть для Facebook?" describes content, not a filter.
	explicit_match = re.search(r"(?:по\s+|для\s+)?подход(?:а|е|у|ом)?\s+([^?.,!]+)", normalized_query)
	requested = approach.name if approach else " ".join(explicit_match.group(1).split()) if explicit_match else None
	approach_exists = True if approach else False if requested else None
	intent = detect_knowledge_intent(query, explicit_search=explicit_search)
	metadata_filters = _resolve_metadata_filters(db, user_id, normalized_query)
	if approach and re.search(
		r"(?:\bчто\b|\bкакие\b|\bесть\b|покаж\w*|перечисл\w*|\bсписок\b|дай\s+(?:мне\s+)?(?:данн\w*|информац\w*|материал\w*))",
		normalized_query,
	):
		intent = "list"
	return KnowledgeQueryResolution(intent, KnowledgeSearchOptions(
		query=query,
		limit=20 if intent == "list" else limit,
		approach_id=approach.id if approach else None,
		approach_name=approach.name if approach else None,
		requested_approach=requested,
		approach_exists=approach_exists,
		approach_profile={
			"id": approach.id,
			"name": approach.name,
			"description": approach.description or "",
			"purpose": approach.purpose or "",
			"characteristics": approach.characteristics or [],
			"structure": approach.structure or [],
			"writingGuidelines": approach.writing_guidelines or [],
			"avoid": approach.avoid or [],
			"exampleKnowledgeItemIds": approach.example_knowledge_item_ids or [],
		} if approach else None,
		**metadata_filters,
	))


@dataclass(frozen=True)
class KnowledgeMatch:
	item: KnowledgeItem
	score: float
	matched_terms: tuple[str, ...]


@dataclass(frozen=True)
class KnowledgeRetrievalResult:
	mode: KnowledgeIntent
	items: list[KnowledgeItem]
	matches: list[KnowledgeMatch]
	owned_items_count: int
	active_items_count: int
	candidate_count: int
	matched_count: int
	reason: str
	approach_id: str | None = None
	approach_name: str | None = None
	requested_approach: str | None = None
	approach_exists: bool | None = None
	approach_profile: dict[str, object] | None = None
	fallback_used: bool = False
	applied_filters: tuple[tuple[str, str], ...] = ()


def _empty_result(mode: KnowledgeIntent, options: KnowledgeSearchOptions, owned_count: int, active_count: int, candidate_count: int, reason: str) -> KnowledgeRetrievalResult:
	return KnowledgeRetrievalResult(
		mode=mode, items=[], matches=[], owned_items_count=owned_count, active_items_count=active_count,
		candidate_count=candidate_count, matched_count=0, reason=reason,
		approach_id=options.approach_id, approach_name=options.approach_name,
		requested_approach=options.requested_approach, approach_exists=options.approach_exists,
		approach_profile=options.approach_profile,
		applied_filters=tuple(options.metadata_filters.items()),
	)


class KnowledgeRetriever(ABC):
	@abstractmethod
	def search(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult: ...


class TextKnowledgeRetriever(KnowledgeRetriever):
	"""Owner-scoped lexical retriever with metadata filters applied before ranking."""

	def search(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
		owned_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id, KnowledgeItem.deleted_at.is_(None),
		)) or 0
		active_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True), KnowledgeItem.deleted_at.is_(None),
		)) or 0
		if options.approach_exists is False:
			return _empty_result("search", options, owned_count, active_count, 0, "approach_not_found")
		conditions = [
			KnowledgeItem.user_id == user_id,
			KnowledgeItem.is_active.is_(True),
			KnowledgeItem.deleted_at.is_(None),
		]
		if options.approach_id:
			example_ids = (options.approach_profile or {}).get("exampleKnowledgeItemIds", [])
			conditions.append(or_(
				KnowledgeItem.approach_id == options.approach_id,
				KnowledgeItem.id.in_(example_ids) if example_ids else KnowledgeItem.approach_id == options.approach_id,
			))
		for key, value in options.metadata_filters.items():
			normalized_value = " ".join(value.split())
			conditions.append(KnowledgeItem.item_metadata[key].as_string().ilike(f"%{normalized_value}%"))
		items = list(db.scalars(select(KnowledgeItem).where(*conditions).order_by(KnowledgeItem.updated_at.desc()).limit(300)))
		if not items:
			reason = "no_active_items_for_approach" if options.approach_id else "no_active_items_for_filters" if options.metadata_filters else "no_active_items"
			return _empty_result("search", options, owned_count, active_count, 0, reason)
		terms = search_terms(options.query)
		if options.approach_name:
			approach_terms = set(search_terms(options.approach_name))
			terms = [term for term in terms if term not in approach_terms]
		filter_terms = [term for value in options.metadata_filters.values() for term in search_terms(value)]
		terms = [term for term in terms if not any(_terms_equivalent(term, filter_term) for filter_term in filter_terms)]
		if not terms:
			selected_items = items[:options.limit]
			matches = [KnowledgeMatch(item, 1.0, ()) for item in selected_items]
			return KnowledgeRetrievalResult(
				mode="search", items=selected_items, matches=matches, owned_items_count=owned_count,
				active_items_count=active_count, candidate_count=len(items), matched_count=len(items),
				reason="metadata_scope_only" if options.metadata_filters else "approach_scope_only" if options.approach_id else "no_meaningful_search_terms",
				approach_id=options.approach_id, approach_name=options.approach_name,
				requested_approach=options.requested_approach, approach_exists=options.approach_exists,
				approach_profile=options.approach_profile,
				applied_filters=tuple(options.metadata_filters.items()),
			)

		scored: list[KnowledgeMatch] = []
		for recency_rank, item in enumerate(items):
			title = normalize_text(item.title)
			content = normalize_text(item.content)
			document_tokens = set(TOKEN_PATTERN.findall(f"{title} {content}"))
			matched_terms: list[str] = []
			score = 0.0
			for term in terms:
				title_hits = title.count(term)
				content_hits = content.count(term)
				if title_hits or content_hits:
					matched_terms.append(term)
					score += title_hits * 3.0 + content_hits
					continue
				if len(term) >= 4 and any(
					document_term.startswith(term[: max(4, len(term) - 2)])
					or term.startswith(document_term[: max(4, len(document_term) - 2)])
					for document_term in document_tokens if len(document_term) >= 4
				):
					matched_terms.append(term)
					score += 0.45
			if matched_terms:
				score += (item.rating or 0) * 0.03
				score += max(0.0, 0.1 - recency_rank * 0.001)
				scored.append(KnowledgeMatch(item, round(score, 4), tuple(matched_terms)))
		scored.sort(key=lambda match: match.score, reverse=True)
		selected = scored[:options.limit]
		return KnowledgeRetrievalResult(
			mode="search", items=[match.item for match in selected], matches=selected,
			owned_items_count=owned_count, active_items_count=active_count, candidate_count=len(items),
			matched_count=len(scored), reason="matched" if selected else "no_textual_overlap",
			approach_id=options.approach_id, approach_name=options.approach_name,
			requested_approach=options.requested_approach, approach_exists=options.approach_exists,
			approach_profile=options.approach_profile,
			fallback_used=any(match.score < 1 for match in selected),
			applied_filters=tuple(options.metadata_filters.items()),
		)


class KnowledgeRetrievalService:
	def __init__(self, retriever: KnowledgeRetriever):
		self.retriever = retriever

	def search(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
		return self.retriever.search(db, user_id, options)

	def list(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
		owned_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id, KnowledgeItem.deleted_at.is_(None),
		)) or 0
		active_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True), KnowledgeItem.deleted_at.is_(None),
		)) or 0
		if options.approach_exists is False:
			return _empty_result("list", options, owned_count, active_count, 0, "approach_not_found")
		conditions = [
			KnowledgeItem.user_id == user_id,
			KnowledgeItem.is_active.is_(True),
			KnowledgeItem.deleted_at.is_(None),
		]
		if options.approach_id:
			example_ids = (options.approach_profile or {}).get("exampleKnowledgeItemIds", [])
			conditions.append(or_(
				KnowledgeItem.approach_id == options.approach_id,
				KnowledgeItem.id.in_(example_ids) if example_ids else KnowledgeItem.approach_id == options.approach_id,
			))
		for key, value in options.metadata_filters.items():
			normalized_value = " ".join(value.split())
			conditions.append(KnowledgeItem.item_metadata[key].as_string().ilike(f"%{normalized_value}%"))
		items = list(db.scalars(select(KnowledgeItem).where(*conditions).order_by(KnowledgeItem.updated_at.desc()).limit(options.limit)))
		if not items:
			reason = "no_active_items_for_approach" if options.approach_id else "no_active_items_for_filters" if options.metadata_filters else "no_active_items"
			return _empty_result("list", options, owned_count, active_count, 0, reason)
		matches = [KnowledgeMatch(item, 1.0, ()) for item in items]
		return KnowledgeRetrievalResult(
			mode="list", items=items, matches=matches, owned_items_count=owned_count,
			active_items_count=active_count, candidate_count=len(items), matched_count=len(items), reason="listed",
			approach_id=options.approach_id, approach_name=options.approach_name,
			requested_approach=options.requested_approach, approach_exists=options.approach_exists,
			approach_profile=options.approach_profile,
			applied_filters=tuple(options.metadata_filters.items()),
		)

	def get(self, db: Session, user_id: str, item_id: str) -> KnowledgeItem | None:
		return db.scalar(select(KnowledgeItem).where(
			KnowledgeItem.id == item_id,
			KnowledgeItem.user_id == user_id,
			KnowledgeItem.is_active.is_(True),
			KnowledgeItem.deleted_at.is_(None),
		))


def log_knowledge_retrieval(result: KnowledgeRetrievalResult, *, user_id: str, query: str, search_mode: str, context_attached: bool) -> None:
	payload: dict[str, object] = {
		"event": "KNOWLEDGE_RETRIEVAL" if result.items else "KNOWLEDGE_RETRIEVAL_EMPTY",
		"userId": user_id, "searchMode": search_mode, "intent": result.mode,
		"retriever": settings.knowledge_search_driver, "approachRequested": result.requested_approach,
		"approachId": result.approach_id, "approachExists": result.approach_exists,
		"metadataFilters": dict(result.applied_filters),
		"ownedItemsAvailable": result.owned_items_count, "activeItemsAvailable": result.active_items_count,
		"candidatesAfterApproachFilter": result.candidate_count, "matched": result.matched_count,
		"returned": len(result.items), "reason": result.reason, "fallbackUsed": result.fallback_used,
		"contextAttached": context_attached,
	}
	if settings.app_env == "development":
		payload["query"] = query
		payload["results"] = [
			{"title": match.item.title, "score": match.score, "rating": match.item.rating, "sourceType": match.item.source_type}
			for match in result.matches
		]
	else:
		payload["queryHash"] = hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]
	logger.info(json.dumps(payload, ensure_ascii=False))


def create_knowledge_retrieval_service() -> KnowledgeRetrievalService:
	if settings.knowledge_search_driver == "text":
		return KnowledgeRetrievalService(TextKnowledgeRetriever())
	raise RuntimeError(f"Unsupported KNOWLEDGE_SEARCH_DRIVER: {settings.knowledge_search_driver}")


knowledge_retrieval_service = create_knowledge_retrieval_service()
