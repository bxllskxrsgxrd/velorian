import re
from abc import ABC, abstractmethod

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import KnowledgeItem


class KnowledgeRetriever(ABC):
	@abstractmethod
	def search(self, db: Session, user_id: str, query: str, limit: int = 4) -> list[KnowledgeItem]: ...


class TextKnowledgeRetriever(KnowledgeRetriever):
	"""Current lexical retriever. The interface is intentionally independent from SQL/vector details."""

	def search(self, db: Session, user_id: str, query: str, limit: int = 4) -> list[KnowledgeItem]:
		items = list(db.scalars(
			select(KnowledgeItem)
			.where(KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True))
			.order_by(KnowledgeItem.updated_at.desc())
			.limit(300)
		))
		terms = {term.lower() for term in re.findall(r"[\w-]+", query, flags=re.UNICODE) if len(term) > 2}
		if not terms:
			return items[:limit]
		scored: list[tuple[float, KnowledgeItem]] = []
		for recency_rank, item in enumerate(items):
			haystack = f"{item.title} {item.content}".lower()
			relevance = sum(haystack.count(term) for term in terms)
			if relevance == 0:
				continue
			rating_boost = (item.rating or 0) * 0.03
			recency_boost = max(0.0, 0.1 - recency_rank * 0.001)
			scored.append((float(relevance) + rating_boost + recency_boost, item))
		scored.sort(key=lambda pair: pair[0], reverse=True)
		return [item for _, item in scored[:limit]]


class KnowledgeRetrievalService:
	def __init__(self, retriever: KnowledgeRetriever):
		self.retriever = retriever

	def search(self, db: Session, user_id: str, query: str, limit: int = 4) -> list[KnowledgeItem]:
		return self.retriever.search(db, user_id, query, limit)


def create_knowledge_retrieval_service() -> KnowledgeRetrievalService:
	if settings.knowledge_search_driver == "text":
		return KnowledgeRetrievalService(TextKnowledgeRetriever())
	raise RuntimeError(f"Unsupported KNOWLEDGE_SEARCH_DRIVER: {settings.knowledge_search_driver}")


knowledge_retrieval_service = create_knowledge_retrieval_service()
