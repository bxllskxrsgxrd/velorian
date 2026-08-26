import asyncio
import base64
import binascii
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, asc, desc, or_, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .errors import AppError
from .file_processing import extract_text, validate_file_name
from .knowledge_retrieval import knowledge_retrieval_service
from .models import Attachment, Conversation, KnowledgeItem, Message, MessageRating, User, utc_now
from .storage import build_storage_key, get_file_storage


router = APIRouter(prefix=f"{settings.api_prefix}/knowledge", tags=["knowledge"])


class KnowledgeCreatePayload(BaseModel):
	title: str = Field(min_length=1, max_length=255)
	content: str = Field(min_length=1, max_length=2_000_000)
	is_active: bool = True
	rating: int | None = Field(default=None, ge=1, le=5)


class KnowledgeUpdatePayload(BaseModel):
	title: str | None = Field(default=None, min_length=1, max_length=255)
	content: str | None = Field(default=None, min_length=1, max_length=2_000_000)
	is_active: bool | None = None
	rating: int | None = Field(default=None, ge=1, le=5)


def knowledge_payload(item: KnowledgeItem) -> dict:
	return {
		"id": item.id,
		"sourceType": item.source_type,
		"sourceMessageId": item.source_message_id,
		"sourceFileId": item.source_file_id,
		"title": item.title,
		"content": item.content,
		"mimeType": item.mime_type,
		"originalFilename": item.original_filename,
		"rating": item.rating,
		"isActive": item.is_active,
		"metadata": item.item_metadata or {},
		"createdAt": item.created_at.isoformat(),
		"updatedAt": item.updated_at.isoformat(),
		"downloadUrl": f"{settings.api_prefix}/knowledge/{item.id}/file" if item.storage_key or item.storage_path or item.source_file_id else None,
	}


def owned_knowledge_item(db: Session, item_id: str, user_id: str) -> KnowledgeItem:
	item = db.scalar(select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.user_id == user_id))
	if item is None:
		raise AppError(404, "KNOWLEDGE_NOT_FOUND", "Элемент базы знаний не найден")
	return item


@router.get("")
def list_knowledge_items(
	search: str = Query(default="", max_length=200),
	source_type: str | None = Query(default=None, max_length=32),
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
		query = f"%{search.strip()}%"
		statement = statement.where(or_(KnowledgeItem.title.ilike(query), KnowledgeItem.content.ilike(query)))
	if source_type:
		statement = statement.where(KnowledgeItem.source_type == source_type)
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
	item = KnowledgeItem(
		user_id=user.id,
		source_type="manual",
		title=payload.title.strip(),
		content=payload.content,
		mime_type="text/plain",
		is_active=payload.is_active,
		rating=payload.rating,
	)
	db.add(item)
	db.commit()
	return {"item": knowledge_payload(item)}


@router.post("/files")
async def upload_knowledge_file(
	file: UploadFile = File(...),
	title: str = Form(default=""),
	rating: int | None = Form(default=None, ge=1, le=5),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
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
		item_metadata={"sha256": checksum, "extractionStatus": extracted.status},
	)
	db.add(item)
	db.flush()
	storage_key = build_storage_key(user.id, "knowledge", item.id)
	await get_file_storage().save(storage_key, content, item.mime_type)
	item.storage_key = storage_key
	db.commit()
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
			user_id=user.id,
			source_type="rated_content",
			source_message_id=message.id,
			title=(message.content.strip().splitlines()[0][:255] or "Сохранённый ответ"),
			content=message.content,
			rating=rating.score,
		)
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
		items.append(file_item)
	db.commit()
	return {"items": [knowledge_payload(item) for item in items]}


@router.get("/{item_id}")
def get_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	return {"item": knowledge_payload(owned_knowledge_item(db, item_id, user.id))}


@router.patch("/{item_id}")
def update_knowledge_item(item_id: str, payload: KnowledgeUpdatePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	if payload.title is not None:
		item.title = payload.title.strip()
	if payload.content is not None:
		item.content = payload.content
	if payload.is_active is not None:
		item.is_active = payload.is_active
	if "rating" in payload.model_fields_set:
		item.rating = payload.rating
	item.updated_at = utc_now()
	db.commit()
	return {"item": knowledge_payload(item)}


@router.delete("/{item_id}", status_code=204)
async def delete_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	storage_path = Path(item.storage_path) if item.storage_path else None
	storage_key = item.storage_key
	db.delete(item)
	db.commit()
	if storage_key:
		await get_file_storage().delete(storage_key)
	elif storage_path is not None:
		await asyncio.to_thread(storage_path.unlink, missing_ok=True)
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
		raise AppError(404, "KNOWLEDGE_FILE_NOT_FOUND", "У элемента нет файла")
	try:
		content = await get_file_storage().get(storage_key) if storage_key else await asyncio.to_thread(legacy_path.read_bytes) if legacy_path else None
	except (FileNotFoundError, OSError):
		content = None
	if content is None:
		raise AppError(404, "ATTACHMENT_MISSING", "Файл отсутствует в хранилище")
	return Response(content, media_type=item.mime_type, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


def retrieve_knowledge(db: Session, user_id: str, query: str, limit: int = 4) -> list[KnowledgeItem]:
	return knowledge_retrieval_service.search(db, user_id, query, limit)


def list_knowledge(db: Session, user_id: str, limit: int = 20) -> list[KnowledgeItem]:
	return knowledge_retrieval_service.list(db, user_id, limit)
