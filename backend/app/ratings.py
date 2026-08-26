from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .errors import AppError
from .models import Conversation, KnowledgeItem, Message, MessageRating, User, utc_now


router = APIRouter(prefix=f"{settings.api_prefix}/messages", tags=["ratings"])


class RatingPayload(BaseModel):
	score: int = Field(ge=1, le=5)
	comment: str | None = Field(default=None, max_length=2000)


def rating_payload(rating: MessageRating) -> dict:
	return {
		"id": rating.id,
		"score": rating.score,
		"comment": rating.comment,
		"createdAt": rating.created_at.isoformat(),
		"updatedAt": rating.updated_at.isoformat(),
	}


def owned_assistant_message(db: Session, message_id: str, user_id: str) -> Message:
	message = db.scalar(
		select(Message)
		.join(Conversation, Conversation.id == Message.conversation_id)
		.where(Message.id == message_id, Message.role == "assistant", Conversation.user_id == user_id)
	)
	if message is None:
		raise AppError(404, "MESSAGE_NOT_FOUND", "Ответ не найден")
	return message


@router.put("/{message_id}/rating")
def upsert_rating(message_id: str, payload: RatingPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	message = owned_assistant_message(db, message_id, user.id)
	rating = db.scalar(select(MessageRating).where(MessageRating.user_id == user.id, MessageRating.message_id == message.id))
	if rating is None:
		rating = MessageRating(user_id=user.id, chat_id=message.conversation_id, message_id=message.id, score=payload.score)
		db.add(rating)
	rating.score = payload.score
	rating.comment = payload.comment.strip() if payload.comment and payload.comment.strip() else None
	rating.updated_at = utc_now()
	for item in db.scalars(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_message_id == message.id)):
		item.rating = rating.score
		item.updated_at = utc_now()
	db.commit()
	return {"rating": rating_payload(rating), "canSaveToKnowledge": rating.score >= settings.knowledge_rating_threshold}


@router.delete("/{message_id}/rating", status_code=204)
def delete_rating(message_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	message = owned_assistant_message(db, message_id, user.id)
	rating = db.scalar(select(MessageRating).where(MessageRating.user_id == user.id, MessageRating.message_id == message.id))
	if rating is not None:
		db.delete(rating)
	for item in db.scalars(select(KnowledgeItem).where(KnowledgeItem.user_id == user.id, KnowledgeItem.source_message_id == message.id)):
		item.rating = None
		item.updated_at = utc_now()
	db.commit()
	return Response(status_code=204)
