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
from .models import KnowledgeItem


logger = logging.getLogger("velorian")
KnowledgeIntent = Literal["list", "search"]
TOKEN_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)
STOP_WORDS = {
	"а", "в", "все", "всё", "для", "есть", "и", "из", "как", "какие", "какой", "мне", "моя", "моей",
	"на", "о", "по", "про", "с", "там", "тебе", "ты", "у", "что", "это", "the", "a", "an", "and", "for", "in", "of", "to",
}


def normalize_text(value: str) -> str:
	return " ".join(value.casefold().replace("ё", "е").split())


def search_terms(value: str) -> list[str]:
	return [term for term in TOKEN_PATTERN.findall(normalize_text(value)) if len(term) > 2 and term not in STOP_WORDS]


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
	fallback_used: bool = False


class KnowledgeRetriever(ABC):
	@abstractmethod
	def search(self, db: Session, user_id: str, query: str, limit: int = 4) -> KnowledgeRetrievalResult: ...


class TextKnowledgeRetriever(KnowledgeRetriever):
	"""Owner-scoped lexical retriever with Unicode normalization and partial-token fallback."""

	def search(self, db: Session, user_id: str, query: str, limit: int = 4) -> KnowledgeRetrievalResult:
		owned_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id,
		)) or 0
		active_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id,
			KnowledgeItem.is_active.is_(True),
		)) or 0
		items = list(db.scalars(
			select(KnowledgeItem)
			.where(KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True))
			.order_by(KnowledgeItem.updated_at.desc())
			.limit(300)
		))
		terms = search_terms(query)
		if not items:
			return KnowledgeRetrievalResult("search", [], [], owned_count, active_count, 0, 0, "no_active_items")
		if not terms:
			return KnowledgeRetrievalResult("search", [], [], owned_count, active_count, len(items), 0, "no_meaningful_search_terms")

		scored: list[KnowledgeMatch] = []
		for recency_rank, item in enumerate(items):
			title = normalize_text(item.title)
			content = normalize_text(item.content)
			document_tokens = set(TOKEN_PATTERN.findall(f"{title} {content}"))
			matched: list[str] = []
			score = 0.0
			for term in terms:
				title_hits = title.count(term)
				content_hits = content.count(term)
				if title_hits or content_hits:
					matched.append(term)
					score += title_hits * 3.0 + content_hits
					continue
				if len(term) >= 4 and any(
					document_term.startswith(term[: max(4, len(term) - 2)])
					or term.startswith(document_term[: max(4, len(document_term) - 2)])
					for document_term in document_tokens if len(document_term) >= 4
				):
					matched.append(term)
					score += 0.45
			if matched:
				score += (item.rating or 0) * 0.03
				score += max(0.0, 0.1 - recency_rank * 0.001)
				scored.append(KnowledgeMatch(item, round(score, 4), tuple(matched)))

		scored.sort(key=lambda match: match.score, reverse=True)
		selected = scored[:limit]
		return KnowledgeRetrievalResult(
			"search",
			[match.item for match in selected],
			selected,
			owned_count,
			active_count,
			len(items),
			len(scored),
			"matched" if selected else "no_textual_overlap",
			fallback_used=any(match.score < 1 for match in selected),
		)


class KnowledgeRetrievalService:
	def __init__(self, retriever: KnowledgeRetriever):
		self.retriever = retriever

	def search(self, db: Session, user_id: str, query: str, limit: int = 4) -> KnowledgeRetrievalResult:
		return self.retriever.search(db, user_id, query, limit)

	def list(self, db: Session, user_id: str, limit: int = 20) -> KnowledgeRetrievalResult:
		owned_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id,
		)) or 0
		active_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
			KnowledgeItem.user_id == user_id,
			KnowledgeItem.is_active.is_(True),
		)) or 0
		items = list(db.scalars(
			select(KnowledgeItem)
			.where(KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True))
			.order_by(KnowledgeItem.updated_at.desc())
			.limit(limit)
		))
		matches = [KnowledgeMatch(item, 1.0, ()) for item in items]
		return KnowledgeRetrievalResult(
			"list", items, matches, owned_count, active_count, len(items), len(items), "listed" if items else "no_active_items",
		)

	def get(self, db: Session, user_id: str, item_id: str) -> KnowledgeItem | None:
		return db.scalar(select(KnowledgeItem).where(
			KnowledgeItem.id == item_id,
			KnowledgeItem.user_id == user_id,
			KnowledgeItem.is_active.is_(True),
		))


def log_knowledge_retrieval(
	result: KnowledgeRetrievalResult,
	*,
	user_id: str,
	query: str,
	search_mode: str,
	context_attached: bool,
) -> None:
	payload: dict[str, object] = {
		"event": "KNOWLEDGE_RETRIEVAL" if result.items else "KNOWLEDGE_RETRIEVAL_EMPTY",
		"userId": user_id,
		"searchMode": search_mode,
		"intent": result.mode,
		"retriever": settings.knowledge_search_driver,
		"ownedItemsAvailable": result.owned_items_count,
		"activeItemsAvailable": result.active_items_count,
		"candidates": result.candidate_count,
		"matched": result.matched_count,
		"returned": len(result.items),
		"reason": result.reason,
		"fallbackUsed": result.fallback_used,
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
