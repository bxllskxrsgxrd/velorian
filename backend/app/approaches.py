import re
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .errors import AppError
from .models import KnowledgeApproach, KnowledgeItem, User, utc_now


router = APIRouter(prefix=f"{settings.api_prefix}/approaches", tags=["approaches"])
RatingValue = Annotated[int, Field(strict=True, ge=1, le=5)]


def normalize_slug(value: str) -> str:
	return re.sub(r"[^\w]+", "-", value.casefold().replace("ё", "е").strip(), flags=re.UNICODE).strip("-")[:96]


class ApproachPayload(BaseModel):
	name: str = Field(min_length=1, max_length=80)
	description: str = Field(default="", max_length=10_000)
	purpose: str = Field(default="", max_length=10_000)
	characteristics: list[str] = Field(default_factory=list, max_length=100)
	structure: list[str] = Field(default_factory=list, max_length=100)
	writing_guidelines: list[str] = Field(default_factory=list, max_length=100)
	avoid: list[str] = Field(default_factory=list, max_length=100)
	example_knowledge_item_ids: list[str] = Field(default_factory=list, max_length=100)
	rating: RatingValue | None = None
	is_active: bool = True

	@field_validator("name", "description", "purpose")
	@classmethod
	def normalize_text(cls, value: str) -> str:
		return value.strip()

	@field_validator("characteristics", "structure", "writing_guidelines", "avoid")
	@classmethod
	def normalize_list(cls, values: list[str]) -> list[str]:
		return [value.strip() for value in values if value.strip()]


class ApproachPatch(BaseModel):
	name: str | None = Field(default=None, min_length=1, max_length=80)
	description: str | None = Field(default=None, max_length=10_000)
	purpose: str | None = Field(default=None, max_length=10_000)
	characteristics: list[str] | None = Field(default=None, max_length=100)
	structure: list[str] | None = Field(default=None, max_length=100)
	writing_guidelines: list[str] | None = Field(default=None, max_length=100)
	avoid: list[str] | None = Field(default=None, max_length=100)
	example_knowledge_item_ids: list[str] | None = Field(default=None, max_length=100)
	rating: RatingValue | None = None
	is_active: bool | None = None

	@field_validator("name", "description", "purpose")
	@classmethod
	def normalize_optional_text(cls, value: str | None) -> str | None:
		return value.strip() if value is not None else None

	@field_validator("characteristics", "structure", "writing_guidelines", "avoid")
	@classmethod
	def normalize_optional_list(cls, values: list[str] | None) -> list[str] | None:
		return [value.strip() for value in values if value.strip()] if values is not None else None


def owned_approach(db: Session, approach_id: str, user_id: str) -> KnowledgeApproach:
	item = db.scalar(select(KnowledgeApproach).where(
		KnowledgeApproach.id == approach_id,
		KnowledgeApproach.user_id == user_id,
	))
	if item is None:
		raise AppError(404, "KNOWLEDGE_APPROACH_NOT_FOUND", "Подход не найден")
	return item


def validate_examples(db: Session, user_id: str, item_ids: list[str]) -> list[str]:
	unique_ids = list(dict.fromkeys(item_ids))
	if not unique_ids:
		return []
	owned_ids = set(db.scalars(select(KnowledgeItem.id).where(
		KnowledgeItem.user_id == user_id,
		KnowledgeItem.deleted_at.is_(None),
		KnowledgeItem.id.in_(unique_ids),
	)))
	if owned_ids != set(unique_ids):
		raise AppError(422, "INVALID_APPROACH_EXAMPLES", "Один или несколько примеров не найдены")
	return unique_ids


def approach_payload(db: Session, item: KnowledgeApproach) -> dict:
	linked_count = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
		KnowledgeItem.user_id == item.user_id,
		KnowledgeItem.approach_id == item.id,
		KnowledgeItem.deleted_at.is_(None),
	)) or 0
	return {
		"id": item.id,
		"name": item.name,
		"description": item.description or "",
		"purpose": item.purpose or "",
		"characteristics": item.characteristics or [],
		"structure": item.structure or [],
		"writingGuidelines": item.writing_guidelines or [],
		"avoid": item.avoid or [],
		"exampleKnowledgeItemIds": item.example_knowledge_item_ids or [],
		"rating": item.rating,
		"isActive": item.is_active,
		"linkedKnowledgeItemsCount": linked_count,
		"createdAt": item.created_at.isoformat(),
		"updatedAt": item.updated_at.isoformat(),
	}


@router.get("")
def list_approaches(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	items = list(db.scalars(select(KnowledgeApproach).where(
		KnowledgeApproach.user_id == user.id,
	).order_by(KnowledgeApproach.name.asc())))
	return {"items": [approach_payload(db, item) for item in items]}


@router.post("", status_code=201)
def create_approach(data: ApproachPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	slug = normalize_slug(data.name)
	if not slug:
		raise AppError(422, "INVALID_APPROACH_NAME", "Введите название подхода")
	item = KnowledgeApproach(
		user_id=user.id,
		name=data.name,
		slug=slug,
		description=data.description,
		purpose=data.purpose,
		characteristics=data.characteristics,
		structure=data.structure,
		writing_guidelines=data.writing_guidelines,
		avoid=data.avoid,
		example_knowledge_item_ids=validate_examples(db, user.id, data.example_knowledge_item_ids),
		rating=data.rating,
		is_active=data.is_active,
	)
	db.add(item)
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_APPROACH_EXISTS", "Подход с таким названием уже существует") from error
	db.refresh(item)
	return {"item": approach_payload(db, item)}


@router.get("/{approach_id}")
def get_approach(approach_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	return {"item": approach_payload(db, owned_approach(db, approach_id, user.id))}


@router.patch("/{approach_id}")
def update_approach(approach_id: str, data: ApproachPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_approach(db, approach_id, user.id)
	changes = data.model_dump(exclude_unset=True)
	if "name" in changes:
		item.name = changes["name"]
		item.slug = normalize_slug(item.name)
		if not item.slug:
			raise AppError(422, "INVALID_APPROACH_NAME", "Введите название подхода")
	for field in ("description", "purpose", "characteristics", "structure", "avoid", "rating", "is_active"):
		if field in changes:
			setattr(item, field, changes[field])
	if "writing_guidelines" in changes:
		item.writing_guidelines = changes["writing_guidelines"]
	if "example_knowledge_item_ids" in changes:
		item.example_knowledge_item_ids = validate_examples(db, user.id, changes["example_knowledge_item_ids"])
	item.updated_at = utc_now()
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_APPROACH_EXISTS", "Подход с таким названием уже существует") from error
	return {"item": approach_payload(db, item)}


@router.delete("/{approach_id}", status_code=204)
def delete_approach(approach_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_approach(db, approach_id, user.id)
	linked = db.scalar(select(func.count()).select_from(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.approach_id == item.id,
	)) or 0
	if linked:
		item.is_active = False
		item.updated_at = utc_now()
	else:
		db.delete(item)
	db.commit()
	return Response(status_code=204)
