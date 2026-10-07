import json
import re
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .knowledge_retrieval import search_terms
from .models import StructuredMemoryItem, utc_now


NamedMemoryCategory = Literal["project", "preferences"]
StructuredMemory = dict[str, dict[str, object] | list[object]]


_BRANCH_LOCAL_MEMORY_PATTERN = re.compile(
	r"\b(?:red|blue)(?:-[a-z0-9]+)+\b"
	r"|\bbranch[- ]local\b"
	r"|\b(?:кодовое слово|секрет|тестов(?:ый|ого) идентификатор)\b"
	r"|\b(?:codeword|secret|test identifier)\b",
	re.IGNORECASE,
)
_MEMORY_SIGNAL_PATTERNS = (
	re.compile(
		r"\b(?:запомни|помни)\b"
		r"|\bсохрани\b.{0,80}\b(?:в память|факт|решени\w*|предпочтени\w*)\b"
		r"|\bremember\b",
		re.IGNORECASE,
	),
	re.compile(
		r"\b(?:мы\s+)?решил(?:и|а|о)?\b"
		r"|\bпринято\s+решение\b"
		r"|\bвыбрали\b"
		r"|\bбудем\s+использовать\b"
		r"|\bwe\s+decided\b",
		re.IGNORECASE,
	),
	re.compile(
		r"\bпредпочитаю\b"
		r"|\bвсегда\s+отвечай\b"
		r"|\bникогда\s+(?:не\s+)?(?:отвечай|используй)\b"
		r"|\bi\s+prefer\b"
		r"|\balways\s+respond\b",
		re.IGNORECASE,
	),
	re.compile(
		r"\bпроект\s+(?:теперь|использует|называется|переименован|настроен)\b"
		r"|\bв\s+проекте\s+теперь\b"
		r"|\b(?:перевели|перенесли|переименовали|обновили)\s+проект\b"
		r"|\bнастройк\w*\s+проекта\b"
		r"|\bproject\s+(?:now|uses|is named)\b",
		re.IGNORECASE,
	),
	re.compile(
		r"\b(?:основн\w+\s+)?ограничени\w*\s+проекта\b"
		r"|\bв\s+проекте\s+(?:нельзя|нужно|должны)\b"
		r"|\bmain\s+project\s+constraint\b",
		re.IGNORECASE,
	),
)
_GLOBAL_PREFERENCE_NAMES = {
	"answer_length",
	"format",
	"language",
	"response_style",
	"tone",
	"verbosity",
}


def should_extract_memory(user_message: str) -> bool:
	text = " ".join(user_message.split())
	if not text or _BRANCH_LOCAL_MEMORY_PATTERN.search(text):
		return False
	return any(pattern.search(text) for pattern in _MEMORY_SIGNAL_PATTERNS)


def _memory_terms_match(left: str, right: str) -> bool:
	if left == right:
		return True
	shared = min(len(left), len(right)) - 1
	return shared >= 5 and left[:shared] == right[:shared]


def retrieve_relevant_memory(
	db: Session,
	user_id: str,
	query: str,
	*,
	limit: int = 5,
) -> list[StructuredMemoryItem]:
	query_terms = search_terms(query)
	if not query_terms or limit <= 0:
		return []
	items = list(db.scalars(
		select(StructuredMemoryItem)
		.where(StructuredMemoryItem.user_id == user_id)
		.order_by(StructuredMemoryItem.updated_at.desc(), StructuredMemoryItem.id),
	))
	scored: list[tuple[float, int, StructuredMemoryItem]] = []
	for recency_rank, item in enumerate(items):
		name_terms = search_terms(item.name or "")
		value_terms = search_terms(json.dumps(item.value, ensure_ascii=False, sort_keys=True))
		score = sum(
			3.0
			for query_term in query_terms
			if any(_memory_terms_match(query_term, term) for term in name_terms)
		)
		score += sum(
			1.0
			for query_term in query_terms
			if any(_memory_terms_match(query_term, term) for term in value_terms)
		)
		if item.category == "preferences" and item.name in _GLOBAL_PREFERENCE_NAMES:
			score += 0.5
		if score > 0:
			scored.append((score, recency_rank, item))
	scored.sort(key=lambda match: (-match[0], match[1]))
	return [item for _, _, item in scored[:limit]]


def read_user_memory(db: Session, user_id: str) -> StructuredMemory:
	items = list(db.scalars(
		select(StructuredMemoryItem)
		.where(StructuredMemoryItem.user_id == user_id)
		.order_by(StructuredMemoryItem.created_at, StructuredMemoryItem.id)
	))
	project: dict[str, object] = {}
	preferences: dict[str, object] = {}
	decisions: list[object] = []
	for item in items:
		if item.category == "decisions":
			decisions.append(item.value)
		elif item.category == "project" and item.name is not None:
			project[item.name] = item.value
		elif item.category == "preferences" and item.name is not None:
			preferences[item.name] = item.value
	return {"project": project, "preferences": preferences, "decisions": decisions}


def _upsert_named_memory(
	db: Session,
	user_id: str,
	category: NamedMemoryCategory,
	name: str,
	value: object,
) -> StructuredMemoryItem:
	normalized_name = name.strip()
	if not normalized_name:
		raise ValueError("Memory name must not be empty")
	item = db.scalar(select(StructuredMemoryItem).where(
		StructuredMemoryItem.user_id == user_id,
		StructuredMemoryItem.category == category,
		StructuredMemoryItem.name == normalized_name,
	))
	if item is None:
		item = StructuredMemoryItem(
			user_id=user_id,
			category=category,
			name=normalized_name,
			value=value,
		)
		db.add(item)
	else:
		item.value = value
		item.updated_at = utc_now()
	db.commit()
	return item


def upsert_project_memory(db: Session, user_id: str, name: str, value: object) -> StructuredMemoryItem:
	return _upsert_named_memory(db, user_id, "project", name, value)


def upsert_preference_memory(db: Session, user_id: str, name: str, value: object) -> StructuredMemoryItem:
	return _upsert_named_memory(db, user_id, "preferences", name, value)


def add_memory_decision(db: Session, user_id: str, value: object) -> StructuredMemoryItem:
	item = StructuredMemoryItem(user_id=user_id, category="decisions", name=None, value=value)
	db.add(item)
	db.commit()
	return item
