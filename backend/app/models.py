from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
	return datetime.now(timezone.utc)


def new_id() -> str:
	return str(uuid4())


class User(Base):
	__tablename__ = "users"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
	password_hash: Mapped[str] = mapped_column(String(255))
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

	conversations: Mapped[list["Conversation"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Conversation(Base):
	__tablename__ = "conversations"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	title: Mapped[str] = mapped_column(String(160), default="Новый диалог")
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

	user: Mapped[User] = relationship(back_populates="conversations")
	messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")
	attachments: Mapped[list["Attachment"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
	__tablename__ = "messages"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	role: Mapped[str] = mapped_column(String(16))
	content: Mapped[str] = mapped_column(Text, default="")
	status: Mapped[str] = mapped_column(String(24), default="done")
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

	conversation: Mapped[Conversation] = relationship(back_populates="messages")
	attachments: Mapped[list["Attachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class Attachment(Base):
	__tablename__ = "attachments"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
	name: Mapped[str] = mapped_column(String(255))
	content_type: Mapped[str] = mapped_column(String(160))
	size: Mapped[int] = mapped_column(Integer)
	storage_path: Mapped[str] = mapped_column(String(1024))
	extraction_status: Mapped[str] = mapped_column(String(32), default="ready")
	extracted_text: Mapped[str] = mapped_column(Text, default="")
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

	conversation: Mapped[Conversation] = relationship(back_populates="attachments")
	message: Mapped[Message] = relationship(back_populates="attachments")
	chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="attachment", cascade="all, delete-orphan")


class DocumentChunk(Base):
	__tablename__ = "document_chunks"

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	attachment_id: Mapped[str] = mapped_column(ForeignKey("attachments.id", ondelete="CASCADE"), index=True)
	position: Mapped[int] = mapped_column(Integer)
	content: Mapped[str] = mapped_column(Text)

	attachment: Mapped[Attachment] = relationship(back_populates="chunks")
