import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .errors import AppError
from .file_processing import extract_text, validate_file_name
from .models import Attachment, Conversation, KnowledgeItem, Message, MessageRating, User, utc_now


router = APIRouter(prefix=f"{settings.api_prefix}/knowledge", tags=["knowledge"])


class KnowledgeCreatePayload(BaseModel):
	title: str = Field(min_length=1, max_length=255)
	content: str = Field(min_length=1, max_length=2_000_000)
	is_active: bool = True


class KnowledgeUpdatePayload(BaseModel):
	title: str | None = Field(default=None, min_length=1, max_length=255)
	content: str | None = Field(default=None, min_length=1, max_length=2_000_000)
	is_active: bool | None = None


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
		"downloadUrl": f"{settings.api_prefix}/knowledge/{item.id}/file" if item.storage_path or item.source_file_id else None,
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
	items = db.scalars(statement.order_by(KnowledgeItem.updated_at.desc()).limit(500)).all()
	return {"items": [knowledge_payload(item) for item in items]}


@router.post("")
def create_manual_knowledge_item(payload: KnowledgeCreatePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = KnowledgeItem(
		user_id=user.id,
		source_type="manual",
		title=payload.title.strip(),
		content=payload.content,
		mime_type="text/plain",
		is_active=payload.is_active,
	)
	db.add(item)
	db.commit()
	return {"item": knowledge_payload(item)}


@router.post("/files")
async def upload_knowledge_file(
	file: UploadFile = File(...),
	title: str = Form(default=""),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	name = validate_file_name(file.filename or "Без имени")
	content = await file.read(settings.max_file_size + 1)
	await file.close()
	if len(content) > settings.max_file_size:
		raise AppError(413, "FILE_TOO_LARGE", f"Файл {name} превышает лимит")
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
		item_metadata={"sha256": checksum, "extractionStatus": extracted.status},
	)
	db.add(item)
	db.flush()
	storage_dir = settings.upload_dir / "knowledge" / user.id
	storage_dir.mkdir(parents=True, exist_ok=True)
	storage_path = storage_dir / item.id
	storage_path.write_bytes(content)
	item.storage_path = str(storage_path)
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
	item.updated_at = utc_now()
	db.commit()
	return {"item": knowledge_payload(item)}


@router.delete("/{item_id}", status_code=204)
def delete_knowledge_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	storage_path = Path(item.storage_path) if item.storage_path else None
	db.delete(item)
	db.commit()
	if storage_path is not None:
		storage_path.unlink(missing_ok=True)
	return Response(status_code=204)


@router.get("/{item_id}/file")
def download_knowledge_file(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	item = owned_knowledge_item(db, item_id, user.id)
	if item.storage_path:
		path = Path(item.storage_path)
		name = item.original_filename or item.title
	elif item.source_file_id:
		attachment = db.scalar(
			select(Attachment)
			.join(Conversation, Conversation.id == Attachment.conversation_id)
			.where(Attachment.id == item.source_file_id, Conversation.user_id == user.id)
		)
		if attachment is None:
			raise AppError(404, "ATTACHMENT_NOT_FOUND", "Исходный файл не найден")
		path = Path(attachment.storage_path)
		name = attachment.name
	else:
		raise AppError(404, "KNOWLEDGE_FILE_NOT_FOUND", "У элемента нет файла")
	if not path.is_file():
		raise AppError(404, "ATTACHMENT_MISSING", "Файл отсутствует в хранилище")
	return FileResponse(path, media_type=item.mime_type, filename=name, content_disposition_type="attachment")


def retrieve_knowledge(db: Session, user_id: str, query: str, limit: int = 4) -> list[KnowledgeItem]:
	items = list(db.scalars(
		select(KnowledgeItem)
		.where(KnowledgeItem.user_id == user_id, KnowledgeItem.is_active.is_(True))
		.order_by(KnowledgeItem.updated_at.desc())
		.limit(300)
	))
	terms = {term.lower() for term in query.split() if len(term) > 2}
	if not terms:
		return items[:limit]
	scored = sorted(
		((sum((item.title + " " + item.content).lower().count(term) for term in terms), item) for item in items),
		key=lambda pair: pair[0],
		reverse=True,
	)
	return [item for score, item in scored if score > 0][:limit]
