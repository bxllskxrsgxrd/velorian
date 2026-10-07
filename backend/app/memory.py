import re
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

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


def should_extract_memory(user_message: str) -> bool:
	text = " ".join(user_message.split())
	if not text or _BRANCH_LOCAL_MEMORY_PATTERN.search(text):
		return False
	return any(pattern.search(text) for pattern in _MEMORY_SIGNAL_PATTERNS)


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
