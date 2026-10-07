from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import StructuredMemoryItem, utc_now


NamedMemoryCategory = Literal["project", "preferences"]
StructuredMemory = dict[str, dict[str, object] | list[object]]


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
