import hashlib
import json
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .knowledge_filters import CanonicalFilterGroup, apply_filter_groups, canonicalize_option_ids, progressive_candidate_counts
from .models import KnowledgeItem


logger = logging.getLogger("velorian")
KnowledgeIntent = Literal["list", "search"]
TOKEN_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)
STOP_WORDS = {
	"а", "в", "все", "всё", "дай", "для", "есть", "и", "из", "как", "какие", "какой", "мне", "моя", "моей",
	"материал", "материалы", "данные", "данных", "на", "о", "по", "про", "с", "там", "тебе", "ты", "у", "что", "это",
	"the", "a", "an", "and", "for", "in", "of", "to",
}


def normalize_text(value: str) -> str:
	return " ".join(value.casefold().replace("ё", "е").split())


def search_terms(value: str) -> list[str]:
	return [term for term in TOKEN_PATTERN.findall(normalize_text(value)) if len(term) > 2 and term not in STOP_WORDS ]


@dataclass(frozen=True)
class KnowledgeSearchOptions:
	query: str
	limit: int = 4
	filter_option_ids: tuple[str, ...] = ()
	filter_groups: tuple[CanonicalFilterGroup, ...] = ()
	resolved_filters: tuple[tuple[str, str], ...] = ()
	unresolved_filters: tuple[tuple[str, str], ...] = ()
	ambiguous_filters: tuple[tuple[str, str], ...] = ()
	approach_id: str | None = None
	approach_name: str | None = None
	requested_approach: str | None = None
	approach_exists: bool | None = None


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
	fallback_used: bool = False
	resolved_filters: tuple[tuple[str, str], ...] = ()
	unresolved_filters: tuple[tuple[str, str], ...] = ()
	ambiguous_filters: tuple[tuple[str, str], ...] = ()
	candidate_counts: tuple[tuple[str, int], ...] = ()


def _empty_result(
	mode: KnowledgeIntent,
	options: KnowledgeSearchOptions,
	owned_count: int,
	active_count: int,
	candidate_count: int,
	reason: str,
	candidate_counts: tuple[tuple[str, int], ...] = (),
) -> KnowledgeRetrievalResult:
	return KnowledgeRetrievalResult(
		mode=mode, items=[], matches=[], owned_items_count=owned_count, active_items_count=active_count,
		candidate_count=candidate_count, matched_count=0, reason=reason,
		approach_id=options.approach_id, approach_name=options.approach_name,
		requested_approach=options.requested_approach, approach_exists=options.approach_exists,
		resolved_filters=options.resolved_filters, unresolved_filters=options.unresolved_filters,
		ambiguous_filters=options.ambiguous_filters, candidate_counts=candidate_counts,
	)


class KnowledgeRetriever(ABC):
	@abstractmethod
	def search(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult: ...


class TextKnowledgeRetriever(KnowledgeRetriever):
	"""Owner-scoped lexical retriever with metadata filters applied before ranking."""

	def search(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
		owned_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(KnowledgeItem.user_id == user_id)) or 0
		active_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True))) or 0
		if options.unresolved_filters:
			return _empty_result("search", options, owned_count, active_count, 0, "filter_value_not_found")
		if options.ambiguous_filters:
			return _empty_result("search", options, owned_count, active_count, 0, "ambiguous_filter")
		if options.approach_exists is False:
			return _empty_result("search", options, owned_count, active_count, 0, "approach_not_found")
		conditions = [KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True)]
		if options.approach_id:
			conditions.append(KnowledgeItem.approach_id == options.approach_id)
		groups = options.filter_groups or canonicalize_option_ids(db, user_id, options.filter_option_ids)
		candidate_counts = progressive_candidate_counts(db, conditions, groups)
		statement = apply_filter_groups(select(KnowledgeItem).where(*conditions), groups)
		items = list(db.scalars(statement.order_by(KnowledgeItem.updated_at.desc()).limit(300)))
		if not items:
			reason = "filter_combination_empty" if len(groups) > 1 else "filter_has_no_items" if groups else "no_active_items_for_approach" if options.approach_id else "knowledge_empty"
			return _empty_result("search", options, owned_count, active_count, 0, reason, candidate_counts)
		terms = search_terms(options.query)
		filter_terms = {term for _, value in options.resolved_filters for term in search_terms(value)}
		terms = [term for term in terms if term not in filter_terms]
		if options.approach_name:
			approach_terms = set(search_terms(options.approach_name))
			terms = [term for term in terms if term not in approach_terms]
		if not terms:
			selected_items = items[:options.limit]
			matches = [KnowledgeMatch(item, 1.0, ()) for item in selected_items]
			return KnowledgeRetrievalResult(
				mode="search", items=selected_items, matches=matches, owned_items_count=owned_count,
				active_items_count=active_count, candidate_count=len(items), matched_count=len(items),
				reason="metadata_scope_only" if groups else "approach_scope_only" if options.approach_id else "no_meaningful_search_terms",
				approach_id=options.approach_id, approach_name=options.approach_name,
				requested_approach=options.requested_approach, approach_exists=options.approach_exists,
				resolved_filters=options.resolved_filters, unresolved_filters=options.unresolved_filters,
				ambiguous_filters=options.ambiguous_filters, candidate_counts=candidate_counts,
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
			matched_count=len(scored), reason="matched" if scored else "no_relevant_text_match",
			approach_id=options.approach_id, approach_name=options.approach_name,
			requested_approach=options.requested_approach, approach_exists=options.approach_exists,
			fallback_used=False,
			resolved_filters=options.resolved_filters, unresolved_filters=options.unresolved_filters,
			ambiguous_filters=options.ambiguous_filters, candidate_counts=candidate_counts,
		)


class KnowledgeRetrievalService:
	def __init__(self, retriever: KnowledgeRetriever):
		self.retriever = retriever

	def search(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
		return self.retriever.search(db, user_id, options)

	def list(self, db: Session, user_id: str, options: KnowledgeSearchOptions) -> KnowledgeRetrievalResult:
		owned_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(KnowledgeItem.user_id == user_id)) or 0
		active_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True))) or 0
		if options.unresolved_filters:
			return _empty_result("list", options, owned_count, active_count, 0, "filter_value_not_found")
		if options.ambiguous_filters:
			return _empty_result("list", options, owned_count, active_count, 0, "ambiguous_filter")
		if options.approach_exists is False:
			return _empty_result("list", options, owned_count, active_count, 0, "approach_not_found")
		conditions = [KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True)]
		if options.approach_id:
			conditions.append(KnowledgeItem.approach_id == options.approach_id)
		groups = options.filter_groups or canonicalize_option_ids(db, user_id, options.filter_option_ids)
		candidate_counts = progressive_candidate_counts(db, conditions, groups)
		statement = apply_filter_groups(select(KnowledgeItem).where(*conditions), groups)
		items = list(db.scalars(statement.order_by(KnowledgeItem.updated_at.desc()).limit(options.limit)))
		if not items:
			reason = "filter_combination_empty" if len(groups) > 1 else "filter_has_no_items" if groups else "no_active_items_for_approach" if options.approach_id else "knowledge_empty"
			return _empty_result("list", options, owned_count, active_count, 0, reason, candidate_counts)
		matches = [KnowledgeMatch(item, 1.0, ()) for item in items]
		return KnowledgeRetrievalResult(
			mode="list", items=items, matches=matches, owned_items_count=owned_count,
			active_items_count=active_count, candidate_count=len(items), matched_count=len(items), reason="listed",
			approach_id=options.approach_id, approach_name=options.approach_name,
			requested_approach=options.requested_approach, approach_exists=options.approach_exists,
			resolved_filters=options.resolved_filters, unresolved_filters=options.unresolved_filters,
			ambiguous_filters=options.ambiguous_filters, candidate_counts=candidate_counts,
		)

	def get(self, db: Session, user_id: str, item_id: str) -> KnowledgeItem | None:
		return db.scalar(select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True)))


def log_knowledge_retrieval(result: KnowledgeRetrievalResult, *, user_id: str, query: str, search_mode: str, context_attached: bool) -> None:
	payload: dict[str, object] = {
		"event": "KNOWLEDGE_RETRIEVAL" if result.items else "KNOWLEDGE_RETRIEVAL_EMPTY",
		"userId": user_id, "searchMode": search_mode, "intent": result.mode,
		"retriever": settings.knowledge_search_driver, "approachRequested": result.requested_approach,
		"approachId": result.approach_id, "approachExists": result.approach_exists,
		"resolvedFilters": [{"name": name, "value": value} for name, value in result.resolved_filters],
		"unresolvedFilters": [{"name": name, "value": value} for name, value in result.unresolved_filters],
		"ambiguousFilters": [{"name": name, "value": value} for name, value in result.ambiguous_filters],
		"ownedItemsAvailable": result.owned_items_count, "activeItemsAvailable": result.active_items_count,
		"candidatesAfterMetadataFilters": result.candidate_count, "matched": result.matched_count,
		"candidateProgress": [{"filterId": filter_id, "count": count} for filter_id, count in result.candidate_counts],
		"returned": len(result.items), "reason": result.reason, "fallbackUsed": result.fallback_used,
		"contextAttached": context_attached,
	}
	if settings.app_env == "development":
		payload["queryHash"] = hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]
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
