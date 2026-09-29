import asyncio
import base64
import binascii
import hashlib
import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .errors import AppError
from .file_processing import extract_text, validate_file_name
from .knowledge_retrieval import KnowledgeRetrievalResult, KnowledgeSearchOptions, knowledge_retrieval_service
from .markdown_files import markdown_file_name, split_markdown_title
from .models import Attachment, Conversation, KnowledgeApproach, KnowledgeItem, Message, MessageRating, User, utc_now
from .storage import build_storage_key, get_file_storage


router = APIRouter(prefix=f"{settings.api_prefix}/knowledge", tags=["knowledge"])
logger = logging.getLogger("velorian")
RatingValue = Annotated[int, Field(strict=True, ge=1, le=5)]
KNOWLEDGE_FILTER_KEYS = ("geo", "celebrity", "offer", "news_source")
KNOWLEDGE_SOURCE_FILTER_GROUPS = {
	"rated_content": ("rated_content", "assistant_message"),
	"uploaded_file": ("uploaded_file", "assistant_file"),
}
TRASH_RETENTION = timedelta(days=30)


class KnowledgeFiltersPayload(BaseModel):
	geo: str | None = Field(default=None, max_length=160)
	celebrity: str | None = Field(default=None, max_length=160)
	offer: str | None = Field(default=None, max_length=160)
	news_source: str | None = Field(default=None, max_length=160)

	@field_validator("geo", "celebrity", "offer", "news_source", mode="before")
	@classmethod
	def normalize_optional_value(cls, value):
		if value is None:
			return None
		if not isinstance(value, str):
			return value
		normalized = " ".join(value.split())
		if normalized.casefold() in {"undefined", "null"}:
			raise ValueError("Invalid empty filter marker")
		return normalized or None


def knowledge_filters(metadata: dict | None) -> dict[str, str | None]:
	metadata = metadata or {}
	return {
		key: value.strip() if isinstance(value := metadata.get(key), str) and value.strip() else None
		for key in KNOWLEDGE_FILTER_KEYS
	}


def merge_knowledge_filters(metadata: dict | None, filters: KnowledgeFiltersPayload | None) -> dict:
	result = dict(metadata or {})
	values = filters.model_dump() if filters is not None else {key: None for key in KNOWLEDGE_FILTER_KEYS}
	for key, value in values.items():
		if value is None:
			result.pop(key, None)
		else:
			result[key] = value
	return result


class KnowledgeCreatePayload(BaseModel):
	title: str = Field(min_length=1, max_length=255)
	content: str = Field(min_length=1, max_length=2_000_000)
	is_active: bool = True
	rating: RatingValue | None = None
	approach_id: str | None = Field(default=None, max_length=36)
	filters: KnowledgeFiltersPayload = Field(default_factory=KnowledgeFiltersPayload)
	source_message_id: str | None = Field(default=None, max_length=36)
	source_file_id: str | None = Field(default=None, max_length=36)


class KnowledgeUpdatePayload(BaseModel):
	title: str | None = Field(default=None, min_length=1, max_length=255)
	content: str | None = Field(default=None, min_length=1, max_length=2_000_000)
	is_active: bool | None = None
	rating: RatingValue | None = None
	approach_id: str | None = Field(default=None, max_length=36)
	filters: KnowledgeFiltersPayload | None = None


class KnowledgeAttachmentPayload(BaseModel):
	title: str | None = Field(default=None, max_length=255)
	is_active: bool = True
	approach_id: str | None = Field(default=None, max_length=36)
	filters: KnowledgeFiltersPayload = Field(default_factory=KnowledgeFiltersPayload)


class ApproachPayload(BaseModel):
	name: str = Field(min_length=1, max_length=80)


DEFAULT_APPROACHES = (("Интервью", "интервью"), ("Шоу", "шоу"))


def normalize_approach_slug(value: str) -> str:
	normalized = value.casefold().replace("ё", "е").strip()
	return re.sub(r"[^\w]+", "-", normalized, flags=re.UNICODE).strip("-")[:96]


def approach_payload(approach: KnowledgeApproach) -> dict:
	return {
		"id": approach.id,
		"name": approach.name,
		"slug": approach.slug,
		"description": approach.description or "",
		"purpose": approach.purpose or "",
		"characteristics": approach.characteristics or [],
		"structure": approach.structure or [],
		"writingGuidelines": approach.writing_guidelines or [],
		"avoid": approach.avoid or [],
		"exampleKnowledgeItemIds": approach.example_knowledge_item_ids or [],
		"rating": approach.rating,
		"isActive": approach.is_active,
		"createdAt": approach.created_at.isoformat(),
		"updatedAt": approach.updated_at.isoformat(),
	}


def ensure_default_approaches(db: Session, user_id: str) -> None:
	existing = set(db.scalars(select(KnowledgeApproach.slug).where(KnowledgeApproach.user_id == user_id)))
	for name, slug in DEFAULT_APPROACHES:
		if slug not in existing:
			db.add(KnowledgeApproach(user_id=user_id, name=name, slug=slug))


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
	legacy_file_name = item.original_filename if item.source_type in {"uploaded_file", "assistant_file"} else None
	file_name = item.current_filename or legacy_file_name or markdown_file_name(item.title, "knowledge")
	return {
		"id": item.id,
		"sourceType": item.source_type,
		"sourceMessageId": item.source_message_id,
		"sourceFileId": item.source_file_id,
		"title": item.title,
		"content": item.content,
		"mimeType": item.current_mime_type or (item.mime_type if legacy_file_name else "text/markdown"),
		"fileName": file_name,
		"originalFilename": item.original_filename,
		"rating": item.rating,
		"approach": approach_payload(item.approach) if item.approach else None,
		"isActive": item.is_active,
		"metadata": item.item_metadata or {},
		"filters": knowledge_filters(item.item_metadata),
		"createdAt": item.created_at.isoformat(),
		"updatedAt": item.updated_at.isoformat(),
		"deletedAt": item.deleted_at.isoformat() if item.deleted_at else None,
		"downloadUrl": f"{settings.api_prefix}/knowledge/{item.id}/file",
		"originalDownloadUrl": f"{settings.api_prefix}/knowledge/{item.id}/file?original=true",
	}


def owned_knowledge_item(db: Session, item_id: str, user_id: str, include_deleted: bool = False) -> KnowledgeItem:
	statement = select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.user_id == user_id)
	if not include_deleted:
		statement = statement.where(KnowledgeItem.deleted_at.is_(None))
	item = db.scalar(statement)
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
	name = " ".join(payload.name.split())
	slug = normalize_approach_slug(name)
	if not slug:
		raise AppError(422, "INVALID_APPROACH_NAME", "Введите название подхода")
	item = KnowledgeApproach(user_id=user.id, name=name, slug=slug)
	db.add(item)
	try:
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_APPROACH_EXISTS", "Подход с таким названием уже существует") from error
	return {"item": approach_payload(item)}


@router.patch("/approaches/{approach_id}")
def rename_approach(approach_id: str, payload: ApproachPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_approach(db, approach_id, user.id)
	item.name = " ".join(payload.name.split())
	item.slug = normalize_approach_slug(item.name)
	if not item.slug:
		raise AppError(422, "INVALID_APPROACH_NAME", "Введите название подхода")
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


@router.get("")
def list_knowledge_items(
	search: str = Query(default="", max_length=200),
	source_type: str | None = Query(default=None, max_length=32),
	approach_id: str | None = Query(default=None, max_length=36),
	geo: str | None = Query(default=None, max_length=160),
	celebrity: str | None = Query(default=None, max_length=160),
	offer: str | None = Query(default=None, max_length=160),
	news_source: str | None = Query(default=None, max_length=160),
	is_active: bool | None = None,
	min_rating: int | None = Query(default=None, ge=1, le=5),
	unrated: bool = False,
	sort: Literal["date_desc", "date_asc", "rating_desc", "rating_asc", "activity_desc", "activity_asc"] = "date_desc",
	limit: int = Query(default=20, ge=1, le=100),
	cursor: str | None = Query(default=None, max_length=512),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	statement = select(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.deleted_at.is_(None),
	)
	if search.strip():
		for term in search.split():
			statement = statement.where(_knowledge_search_condition(db, term))
	if source_type:
		statement = statement.where(
			KnowledgeItem.source_type.in_(KNOWLEDGE_SOURCE_FILTER_GROUPS.get(source_type, (source_type,)))
		)
	if approach_id:
		owned_approach(db, approach_id, user.id)
		statement = statement.where(KnowledgeItem.approach_id == approach_id)
	for key, value in {"geo": geo, "celebrity": celebrity, "offer": offer, "news_source": news_source}.items():
		if value and value.strip():
			normalized_value = " ".join(value.split())
			statement = statement.where(KnowledgeItem.item_metadata[key].as_string().ilike(f"%{normalized_value}%"))
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
		"activity_desc": (desc(KnowledgeItem.is_active), desc(KnowledgeItem.updated_at), desc(KnowledgeItem.id)),
		"activity_asc": (asc(KnowledgeItem.is_active), desc(KnowledgeItem.updated_at), desc(KnowledgeItem.id)),
	}[sort]
	if cursor:
		try:
			decoded = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode())
			if decoded["sort"] != sort:
				raise ValueError
			cursor_updated = datetime.fromisoformat(decoded["updated"])
			cursor_id = str(decoded["id"])
			cursor_rating = decoded.get("rating")
			cursor_is_active = decoded.get("isActive")
			if sort.startswith("activity_") and not isinstance(cursor_is_active, bool):
				raise ValueError
		except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
			raise AppError(422, "INVALID_CURSOR", "Некорректный курсор страницы")
		date_desc_after = or_(KnowledgeItem.updated_at < cursor_updated, and_(KnowledgeItem.updated_at == cursor_updated, KnowledgeItem.id < cursor_id))
		date_asc_after = or_(KnowledgeItem.updated_at > cursor_updated, and_(KnowledgeItem.updated_at == cursor_updated, KnowledgeItem.id > cursor_id))
		if sort == "date_desc":
			statement = statement.where(date_desc_after)
		elif sort == "date_asc":
			statement = statement.where(date_asc_after)
		elif sort == "activity_desc":
			statement = statement.where(
				or_(KnowledgeItem.is_active.is_(False), and_(KnowledgeItem.is_active.is_(True), date_desc_after))
				if cursor_is_active
				else and_(KnowledgeItem.is_active.is_(False), date_desc_after)
			)
		elif sort == "activity_asc":
			statement = statement.where(
				or_(KnowledgeItem.is_active.is_(True), and_(KnowledgeItem.is_active.is_(False), date_desc_after))
				if not cursor_is_active
				else and_(KnowledgeItem.is_active.is_(True), date_desc_after)
			)
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
		cursor_payload = json.dumps({"sort": sort, "updated": last.updated_at.isoformat(), "id": last.id, "rating": last.rating, "isActive": last.is_active}, separators=(",", ":"))
		next_cursor = base64.urlsafe_b64encode(cursor_payload.encode()).decode().rstrip("=")
	else:
		next_cursor = None
	return {"items": [knowledge_payload(item) for item in items], "pageInfo": {"nextCursor": next_cursor, "hasMore": has_more}}


@router.post("")
async def create_manual_knowledge_item(payload: KnowledgeCreatePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	approach = optional_owned_approach(db, payload.approach_id, user.id)
	message: Message | None = None
	attachment: Attachment | None = None
	if payload.source_message_id:
		message = db.scalar(
			select(Message)
			.join(Conversation, Conversation.id == Message.conversation_id)
			.where(
				Message.id == payload.source_message_id,
				Message.role == "assistant",
				Conversation.user_id == user.id,
			)
		)
		if message is None:
			raise AppError(404, "MESSAGE_NOT_FOUND", "Ответ не найден")
	if payload.source_file_id:
		if message is None:
			raise AppError(422, "KNOWLEDGE_SOURCE_INVALID", "Для файла не указан исходный ответ")
		attachment = db.scalar(select(Attachment).where(
			Attachment.id == payload.source_file_id,
			Attachment.message_id == message.id,
		))
		if attachment is None:
			raise AppError(404, "ATTACHMENT_NOT_FOUND", "Созданный файл не найден")
	if message is not None:
		conditions = [KnowledgeItem.source_message_id == message.id]
		if attachment is not None:
			conditions.append(KnowledgeItem.source_file_id == attachment.id)
		existing = db.scalar(select(KnowledgeItem).where(
			KnowledgeItem.user_id == user.id,
			or_(*conditions),
		))
		if existing is not None:
			raise AppError(409, "KNOWLEDGE_SOURCE_EXISTS", "Для этого ответа уже существует запись в базе знаний", {
				"itemId": existing.id,
				"deletedAt": existing.deleted_at.isoformat() if existing.deleted_at else None,
			})
	item = KnowledgeItem(
		user_id=user.id,
		source_type="assistant_file" if attachment is not None else ("assistant_message" if message is not None else "manual"),
		source_message_id=message.id if message is not None else None,
		source_file_id=attachment.id if attachment is not None else None,
		title=payload.title.strip(),
		content=payload.content,
		mime_type=attachment.content_type if attachment is not None else "text/markdown",
		original_filename=attachment.name if attachment is not None else None,
		is_active=payload.is_active,
		rating=payload.rating,
		approach=approach,
		item_metadata=merge_knowledge_filters({}, payload.filters),
	)
	db.add(item)
	try:
		db.flush()
		if attachment is not None:
			await _persist_attachment_copy(db, item, attachment, commit=False)
		db.commit()
	except IntegrityError as error:
		db.rollback()
		raise AppError(409, "KNOWLEDGE_SOURCE_EXISTS", "Для этого ответа уже существует запись в базе знаний") from error
	return {"item": knowledge_payload(item)}


@router.get("/messages/{message_id}/link")
def get_message_knowledge_link(message_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	message = db.scalar(
		select(Message)
		.join(Conversation, Conversation.id == Message.conversation_id)
		.where(Message.id == message_id, Message.role == "assistant", Conversation.user_id == user.id)
	)
	if message is None:
		raise AppError(404, "MESSAGE_NOT_FOUND", "Ответ не найден")
	item = db.scalar(select(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.source_message_id == message.id,
	))
	return {"item": {
		"id": item.id,
		"deletedAt": item.deleted_at.isoformat() if item.deleted_at else None,
		"rating": item.rating,
	} if item is not None else None}


@router.post("/files")
async def upload_knowledge_file(
	file: UploadFile = File(...),
	title: str = Form(default=""),
	content: str | None = Form(default=None, max_length=2_000_000),
	rating: int | None = Form(default=None, ge=1, le=5),
	is_active: bool = Form(default=True),
	approach_id: str | None = Form(default=None, max_length=36),
	geo: str | None = Form(default=None, max_length=160),
	celebrity: str | None = Form(default=None, max_length=160),
	offer: str | None = Form(default=None, max_length=160),
	news_source: str | None = Form(default=None, max_length=160),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	approach = optional_owned_approach(db, approach_id, user.id)
	name = validate_file_name(file.filename or "Без имени")
	file_content = await file.read(settings.max_file_size + 1)
	await file.close()
	if len(file_content) > settings.max_file_size:
		raise AppError(413, "FILE_SIZE_LIMIT_EXCEEDED", f"Файл {name} превышает лимит", {
			"fileName": name, "actualSize": len(file_content), "maximumSize": settings.max_file_size,
		})
	extracted = extract_text(name, file.content_type or "application/octet-stream", file_content)
	if extracted.status not in {"ready", "empty", "ocr_unavailable"}:
		raise AppError(422, "FILE_PROCESSING_FAILED", f"Не удалось обработать файл {name}")
	item_title = title.strip()[:255] or name
	item_content = content if content is not None else extracted.text
	checksum = hashlib.sha256(file_content).hexdigest()
	item = KnowledgeItem(
		user_id=user.id,
		source_type="uploaded_file",
		title=item_title,
		content=item_content,
		mime_type=file.content_type or "application/octet-stream",
		original_filename=name,
		rating=rating,
		is_active=is_active,
		approach=approach,
		item_metadata=merge_knowledge_filters(
			{"sha256": checksum, "extractionStatus": extracted.status},
			KnowledgeFiltersPayload(geo=geo, celebrity=celebrity, offer=offer, news_source=news_source),
		),
	)
	db.add(item)
	db.flush()
	storage_key = build_storage_key(user.id, "knowledge", item.id)
	storage = get_file_storage()
	try:
		await storage.save(storage_key, file_content, item.mime_type)
		item.storage_key = storage_key
		item.current_storage_key = storage_key
		item.current_filename = name
		item.current_mime_type = item.mime_type
		db.commit()
	except Exception:
		db.rollback()
		try:
			await storage.delete(storage_key)
		except Exception:
			logger.exception("Knowledge upload cleanup failed: storage_key=%s", storage_key)
		raise
	return {"item": knowledge_payload(item)}


async def _persist_attachment_copy(
	db: Session,
	item: KnowledgeItem,
	attachment: Attachment,
	commit: bool = True,
) -> str | None:
	if item.storage_key or item.storage_path:
		if commit:
			db.commit()
		return None
	storage = get_file_storage()
	storage_key: str | None = None
	try:
		content = (
			await storage.get(attachment.storage_key)
			if attachment.storage_key
			else await asyncio.to_thread(Path(attachment.storage_path).read_bytes)
		)
		storage_key = build_storage_key(item.user_id, "knowledge", item.id)
		await storage.save(storage_key, content, attachment.content_type)
		item.storage_key = storage_key
		item.current_storage_key = storage_key
		item.current_filename = attachment.name
		item.current_mime_type = attachment.content_type
		if commit:
			db.commit()
		return storage_key
	except (FileNotFoundError, OSError) as error:
		db.rollback()
		raise AppError(404, "ATTACHMENT_MISSING", "Файл отсутствует в хранилище") from error
	except Exception:
		db.rollback()
		if storage_key:
			try:
				await storage.delete(storage_key)
			except Exception:
				logger.exception("Knowledge attachment cleanup failed: storage_key=%s", storage_key)
		raise


@router.post("/attachments/{attachment_id}")
async def save_attachment_to_knowledge(
	attachment_id: str,
	payload: KnowledgeAttachmentPayload,
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	attachment = db.scalar(
		select(Attachment)
		.join(Conversation, Conversation.id == Attachment.conversation_id)
		.where(Attachment.id == attachment_id, Conversation.user_id == user.id)
	)
	if attachment is None:
		raise AppError(404, "ATTACHMENT_NOT_FOUND", "Файл не найден")
	existing = db.scalar(select(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.source_file_id == attachment.id,
	))
	if existing is not None:
		if existing.deleted_at is not None:
			existing.deleted_at = None
			existing.updated_at = utc_now()
		await _persist_attachment_copy(db, existing, attachment)
		return {"item": knowledge_payload(existing), "created": False}
	if not attachment.extracted_text.strip():
		raise AppError(422, "EMPTY_KNOWLEDGE_FILE", "Пустой файл нельзя добавить в базу знаний")
	approach = optional_owned_approach(db, payload.approach_id, user.id)
	is_generated_markdown = attachment.extraction_status == "generated_markdown"
	content = attachment.extracted_text
	semantic_title: str | None = None
	if is_generated_markdown:
		source_message = db.get(Message, attachment.message_id) if attachment.message_id else None
		if source_message is not None:
			source_title, source_body = split_markdown_title(source_message.content)
			if source_body != source_message.content:
				semantic_title = source_title
		file_title, file_body = split_markdown_title(content)
		if file_body != content:
			semantic_title = semantic_title or file_title
			content = file_body
	title = (payload.title or semantic_title or Path(attachment.name).stem).strip()
	if is_generated_markdown and title.lower().endswith(".md"):
		title = title[:-3].rstrip()
	title = title[:255]
	item = KnowledgeItem(
		user_id=user.id,
		source_type="assistant_file" if attachment.extraction_status.startswith("generated") else "uploaded_file",
		source_message_id=attachment.message_id,
		source_file_id=attachment.id,
		title=title or "Сохранённый файл",
		content=content,
		mime_type="text/markdown" if attachment.name.lower().endswith(".md") else attachment.content_type,
		original_filename=attachment.name,
		is_active=payload.is_active,
		approach=approach,
		item_metadata=merge_knowledge_filters(
			{"extractionStatus": attachment.extraction_status}, payload.filters,
		),
	)
	db.add(item)
	try:
		db.flush()
	except IntegrityError:
		db.rollback()
		existing = db.scalar(select(KnowledgeItem).where(
			KnowledgeItem.user_id == user.id, KnowledgeItem.source_file_id == attachment.id,
		))
		if existing is None:
			raise
		if existing.deleted_at is not None:
			existing.deleted_at = None
			existing.updated_at = utc_now()
		await _persist_attachment_copy(db, existing, attachment)
		return {"item": knowledge_payload(existing), "created": False}
	await _persist_attachment_copy(db, item, attachment)
	return {"item": knowledge_payload(item), "created": True}


@router.post("/messages/{message_id}")
async def save_rated_message(message_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
	message_title, message_content = split_markdown_title(message.content, "Сохранённый ответ")
	message_item = db.scalar(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_message_id == message.id))
	if message_item is None:
		message_item = KnowledgeItem(
			user_id=user.id,
			source_type="rated_content",
			source_message_id=message.id,
			title=message_title[:255],
			content=message_content,
			mime_type="text/markdown",
			rating=rating.score,
		)
		db.add(message_item)
	else:
		message_item.title = message_title[:255]
		message_item.content = message_content
		message_item.rating = rating.score
		message_item.is_active = True
		message_item.deleted_at = None
		message_item.updated_at = utc_now()
	items.append(message_item)
	file_copies: list[tuple[KnowledgeItem, Attachment]] = []
	for attachment in message.attachments:
		file_item = db.scalar(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_file_id == attachment.id))
		if file_item is None:
			file_item = KnowledgeItem(
				user_id=user.id,
				source_type="uploaded_file",
				source_message_id=message.id,
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
			file_item.deleted_at = None
			file_item.updated_at = utc_now()
		items.append(file_item)
		file_copies.append((file_item, attachment))
	copied_storage_keys: list[str] = []
	try:
		db.flush()
		for file_item, attachment in file_copies:
			storage_key = await _persist_attachment_copy(db, file_item, attachment, commit=False)
			if storage_key:
				copied_storage_keys.append(storage_key)
		db.commit()
	except Exception:
		db.rollback()
		storage = get_file_storage()
		for storage_key in copied_storage_keys:
			try:
				await storage.delete(storage_key)
			except Exception:
				logger.exception("Rated Knowledge cleanup failed: storage_key=%s", storage_key)
		raise
	return {"items": [knowledge_payload(item) for item in items]}


async def permanently_delete_knowledge_item(db: Session, item: KnowledgeItem) -> None:
	storage_path = Path(item.storage_path) if item.storage_path else None
	storage = get_file_storage()
	storage_files = {
		key: mime_type
		for key, mime_type in (
			(item.storage_key, item.mime_type),
			(item.current_storage_key, item.current_mime_type or "application/octet-stream"),
		)
		if key
	}
	removed_storage_files: list[tuple[str, bytes | None, str]] = []
	legacy_backup: bytes | None = None
	legacy_removed = False

	async def restore_removed_files() -> None:
		for key, content, mime_type in removed_storage_files:
			if content is not None:
				await storage.save(key, content, mime_type)
		if legacy_removed and legacy_backup is not None and storage_path is not None:
			await asyncio.to_thread(storage_path.write_bytes, legacy_backup)

	try:
		for storage_key, mime_type in storage_files.items():
			try:
				file_backup = await storage.get(storage_key)
			except (FileNotFoundError, OSError):
				file_backup = None
			await storage.delete(storage_key)
			removed_storage_files.append((storage_key, file_backup, mime_type))
		if storage_path is not None and storage_path.exists():
			legacy_backup = await asyncio.to_thread(storage_path.read_bytes)
			await asyncio.to_thread(storage_path.unlink, missing_ok=True)
			legacy_removed = True
	except Exception as error:
		try:
			await restore_removed_files()
		except Exception:
			logger.critical("Knowledge files restore failed after storage deletion error: item_id=%s", item.id, exc_info=True)
		logger.exception("Knowledge file deletion failed; preserving database item: item_id=%s", item.id)
		raise AppError(503, "KNOWLEDGE_FILE_DELETE_FAILED", "Не удалось удалить файл. Запись сохранена, повторите попытку.") from error
	try:
		db.delete(item)
		db.commit()
	except Exception:
		db.rollback()
		try:
			await restore_removed_files()
		except Exception:
			logger.critical("Knowledge file restore failed after database rollback: item_id=%s", item.id, exc_info=True)
		raise


async def purge_expired_knowledge_items(db: Session, now: datetime | None = None) -> None:
	cutoff = (now or utc_now()) - TRASH_RETENTION
	item_ids = list(db.scalars(select(KnowledgeItem.id).where(
		KnowledgeItem.deleted_at.is_not(None),
		KnowledgeItem.deleted_at <= cutoff,
	)))
	for item_id in item_ids:
		item = db.get(KnowledgeItem, item_id)
		if item is None:
			continue
		try:
			await permanently_delete_knowledge_item(db, item)
		except Exception:
			logger.exception("Expired Knowledge cleanup failed: item_id=%s", item_id)


@router.get("/trash")
def list_deleted_knowledge_items(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	items = list(db.scalars(select(KnowledgeItem).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.deleted_at.is_not(None),
	).order_by(KnowledgeItem.deleted_at.desc())))
	return {"items": [knowledge_payload(item) for item in items]}


@router.post("/trash/{item_id}/restore")
def restore_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id, include_deleted=True)
	if item.deleted_at is None:
		raise AppError(409, "KNOWLEDGE_NOT_DELETED", "Запись не находится в корзине")
	item.deleted_at = None
	item.updated_at = utc_now()
	db.commit()
	return {"item": knowledge_payload(item)}


@router.delete("/trash", status_code=204)
async def empty_knowledge_trash(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item_ids = list(db.scalars(select(KnowledgeItem.id).where(
		KnowledgeItem.user_id == user.id,
		KnowledgeItem.deleted_at.is_not(None),
	)))
	for item_id in item_ids:
		item = db.get(KnowledgeItem, item_id)
		if item is not None:
			await permanently_delete_knowledge_item(db, item)
	return Response(status_code=204)


@router.delete("/trash/{item_id}", status_code=204)
async def permanently_delete_knowledge_item_endpoint(
	item_id: str,
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	item = owned_knowledge_item(db, item_id, user.id, include_deleted=True)
	if item.deleted_at is None:
		raise AppError(409, "KNOWLEDGE_NOT_DELETED", "Сначала переместите запись в корзину")
	await permanently_delete_knowledge_item(db, item)
	return Response(status_code=204)


@router.get("/{item_id}")
def get_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	return {"item": knowledge_payload(owned_knowledge_item(db, item_id, user.id))}


@router.patch("/{item_id}")
async def update_knowledge_item(item_id: str, payload: KnowledgeUpdatePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	updates_file_content = payload.title is not None or payload.content is not None
	storage = get_file_storage()
	created_original_key: str | None = None
	created_current_key: str | None = None
	previous_current_key = item.current_storage_key
	try:
		if updates_file_content and not item.storage_key and not item.storage_path:
			if item.source_file_id:
				attachment = db.get(Attachment, item.source_file_id)
				if attachment is None:
					raise AppError(404, "ATTACHMENT_NOT_FOUND", "Исходный файл не найден")
				created_original_key = await _persist_attachment_copy(db, item, attachment, commit=False)
			else:
				created_original_key = build_storage_key(user.id, "knowledge", item.id)
				await storage.save(created_original_key, item.content.encode("utf-8"), "text/markdown")
				item.storage_key = created_original_key
				item.original_filename = markdown_file_name(item.title, "knowledge")

		if payload.title is not None:
			item.title = payload.title.strip()
		if payload.content is not None:
			item.content = payload.content
		if updates_file_content:
			created_current_key = build_storage_key(user.id, "knowledge", item.id)
			await storage.save(created_current_key, item.content.encode("utf-8"), "text/markdown")
			item.current_storage_key = created_current_key
			item.current_filename = markdown_file_name(item.title, "knowledge")
			item.current_mime_type = "text/markdown"
		if payload.is_active is not None:
			item.is_active = payload.is_active
		if "rating" in payload.model_fields_set:
			item.rating = payload.rating
		if "approach_id" in payload.model_fields_set:
			item.approach = optional_owned_approach(db, payload.approach_id, user.id)
		if "filters" in payload.model_fields_set:
			item.item_metadata = merge_knowledge_filters(item.item_metadata, payload.filters)
		item.updated_at = utc_now()
		db.commit()
	except Exception:
		db.rollback()
		for storage_key in (created_current_key, created_original_key):
			if not storage_key:
				continue
			try:
				await storage.delete(storage_key)
			except Exception:
				logger.exception("Knowledge text update cleanup failed: storage_key=%s", storage_key)
		raise
	if updates_file_content and previous_current_key and previous_current_key not in {item.storage_key, created_current_key}:
		try:
			await storage.delete(previous_current_key)
		except Exception:
			logger.exception("Previous Knowledge current file cleanup failed: storage_key=%s", previous_current_key)
	return {"item": knowledge_payload(item)}


@router.put("/{item_id}/file")
async def update_knowledge_file(
	item_id: str,
	file: UploadFile = File(...),
	title: str = Form(default="", max_length=255),
	content: str | None = Form(default=None, max_length=2_000_000),
	rating: int | None = Form(default=None, ge=1, le=5),
	clear_rating: bool = Form(default=False),
	is_active: bool = Form(default=True),
	approach_id: str | None = Form(default=None, max_length=36),
	geo: str | None = Form(default=None, max_length=160),
	celebrity: str | None = Form(default=None, max_length=160),
	offer: str | None = Form(default=None, max_length=160),
	news_source: str | None = Form(default=None, max_length=160),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	item = owned_knowledge_item(db, item_id, user.id)
	approach = optional_owned_approach(db, approach_id, user.id)
	name = validate_file_name(file.filename or "Без имени")
	file_content = await file.read(settings.max_file_size + 1)
	await file.close()
	if len(file_content) > settings.max_file_size:
		raise AppError(413, "FILE_SIZE_LIMIT_EXCEEDED", f"Файл {name} превышает лимит", {
			"fileName": name, "actualSize": len(file_content), "maximumSize": settings.max_file_size,
		})
	extracted = extract_text(name, file.content_type or "application/octet-stream", file_content)
	if extracted.status not in {"ready", "empty", "ocr_unavailable"}:
		raise AppError(422, "FILE_PROCESSING_FAILED", f"Не удалось обработать файл {name}")

	storage = get_file_storage()
	created_original_key: str | None = None
	new_current_key = build_storage_key(user.id, "knowledge", item.id)
	previous_current_key = item.current_storage_key
	try:
		if not item.storage_key and not item.storage_path:
			if item.source_file_id:
				attachment = db.get(Attachment, item.source_file_id)
				if attachment is None:
					raise AppError(404, "ATTACHMENT_NOT_FOUND", "Исходный файл не найден")
				created_original_key = await _persist_attachment_copy(db, item, attachment, commit=False)
			else:
				created_original_key = build_storage_key(user.id, "knowledge", item.id)
				await storage.save(created_original_key, item.content.encode("utf-8"), "text/markdown")
				item.storage_key = created_original_key
				item.original_filename = markdown_file_name(item.title, "knowledge")

		current_mime_type = file.content_type or "application/octet-stream"
		await storage.save(new_current_key, file_content, current_mime_type)
		item.source_type = "uploaded_file"
		item.title = title.strip()[:255] or name
		item.content = content if content is not None else extracted.text
		item.current_storage_key = new_current_key
		item.current_filename = name
		item.current_mime_type = current_mime_type
		item.rating = None if clear_rating else rating
		item.is_active = is_active
		item.approach = approach
		item.item_metadata = merge_knowledge_filters(
			{
				**(item.item_metadata or {}),
				"sha256": hashlib.sha256(file_content).hexdigest(),
				"extractionStatus": extracted.status,
			},
			KnowledgeFiltersPayload(geo=geo, celebrity=celebrity, offer=offer, news_source=news_source),
		)
		item.updated_at = utc_now()
		db.commit()
	except Exception:
		db.rollback()
		for storage_key in (new_current_key, created_original_key):
			if not storage_key:
				continue
			try:
				await storage.delete(storage_key)
			except Exception:
				logger.exception("Knowledge file update cleanup failed: storage_key=%s", storage_key)
		raise
	if previous_current_key and previous_current_key not in {item.storage_key, new_current_key}:
		try:
			await storage.delete(previous_current_key)
		except Exception:
			logger.exception("Previous Knowledge current file cleanup failed: storage_key=%s", previous_current_key)
	return {"item": knowledge_payload(item)}


@router.delete("/{item_id}", status_code=204)
def delete_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	item.deleted_at = utc_now()
	item.updated_at = utc_now()
	db.commit()
	return Response(status_code=204)


@router.get("/{item_id}/file")
async def download_knowledge_file(
	item_id: str,
	original: bool = Query(default=False),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	item = owned_knowledge_item(db, item_id, user.id)
	if not original:
		if item.current_storage_key:
			try:
				current_content = await get_file_storage().get(item.current_storage_key)
			except (FileNotFoundError, OSError):
				raise AppError(404, "KNOWLEDGE_CURRENT_FILE_MISSING", "Текущий файл отсутствует в хранилище")
			name = item.current_filename or item.title
			return Response(
				current_content,
				media_type=item.current_mime_type or "application/octet-stream",
				headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
			)
		if item.storage_key and item.source_type in {"uploaded_file", "assistant_file"}:
			try:
				legacy_content = await get_file_storage().get(item.storage_key)
			except (FileNotFoundError, OSError):
				legacy_content = None
			stored_checksum = (item.item_metadata or {}).get("sha256")
			if legacy_content is not None and (
				not stored_checksum or hashlib.sha256(legacy_content).hexdigest() == stored_checksum
			):
				name = item.original_filename or item.title
				return Response(
					legacy_content,
					media_type=item.mime_type,
					headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
				)
		name = markdown_file_name(item.title, "knowledge")
		return Response(
			item.content.encode("utf-8"),
			media_type="text/markdown",
			headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
		)
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
		name = item.original_filename or markdown_file_name(item.title, "knowledge")
		return Response(
			item.content.encode("utf-8"),
			media_type=item.mime_type or "text/markdown",
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
