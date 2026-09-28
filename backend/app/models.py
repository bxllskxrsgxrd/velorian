from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
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
	login: Mapped[str] = mapped_column(String(80), unique=True, index=True)
	password_hash: Mapped[str] = mapped_column(String(255))
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

	conversations: Mapped[list["Conversation"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	ratings: Mapped[list["MessageRating"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	knowledge_approaches: Mapped[list["KnowledgeApproach"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Conversation(Base):
	__tablename__ = "conversations"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	title: Mapped[str] = mapped_column(String(160), default="Новый чат")
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
	deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

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
	error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
	request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
	knowledge_sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
	search_mode: Mapped[str] = mapped_column(String(16), default="none")
	branch_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
	reply_to_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
	is_active: Mapped[bool] = mapped_column(Boolean, default=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

	conversation: Mapped[Conversation] = relationship(back_populates="messages")
	attachments: Mapped[list["Attachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")
	ratings: Mapped[list["MessageRating"]] = relationship(back_populates="message", cascade="all, delete-orphan")
	knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(back_populates="source_message")


class Attachment(Base):
	__tablename__ = "attachments"

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
	name: Mapped[str] = mapped_column(String(255))
	content_type: Mapped[str] = mapped_column(String(160))
	size: Mapped[int] = mapped_column(Integer)
	storage_path: Mapped[str] = mapped_column(String(1024))
	storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
	extraction_status: Mapped[str] = mapped_column(String(32), default="ready")
	extracted_text: Mapped[str] = mapped_column(Text, default="")
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

	conversation: Mapped[Conversation] = relationship(back_populates="attachments")
	message: Mapped[Message] = relationship(back_populates="attachments")
	chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="attachment", cascade="all, delete-orphan")
	knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(back_populates="source_file")


class DocumentChunk(Base):
	__tablename__ = "document_chunks"

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	attachment_id: Mapped[str] = mapped_column(ForeignKey("attachments.id", ondelete="CASCADE"), index=True)
	position: Mapped[int] = mapped_column(Integer)
	content: Mapped[str] = mapped_column(Text)

	attachment: Mapped[Attachment] = relationship(back_populates="chunks")


class MessageRating(Base):
	__tablename__ = "message_ratings"
	__table_args__ = (
		UniqueConstraint("user_id", "message_id", name="uq_message_rating_user_message"),
		CheckConstraint("score >= 1 AND score <= 5", name="ck_message_rating_score"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	chat_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
	score: Mapped[int] = mapped_column(Integer)
	comment: Mapped[str | None] = mapped_column(Text, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

	user: Mapped[User] = relationship(back_populates="ratings")
	message: Mapped[Message] = relationship(back_populates="ratings")


class KnowledgeApproach(Base):
	__tablename__ = "knowledge_approaches"
	__table_args__ = (
		UniqueConstraint("user_id", "slug", name="uq_knowledge_approach_user_slug"),
		CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_knowledge_approach_rating"),
		Index("ix_knowledge_approach_user_name", "user_id", "name"),
		Index("ix_knowledge_approach_user_rating", "user_id", "rating"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	name: Mapped[str] = mapped_column(String(80))
	slug: Mapped[str] = mapped_column(String(96))
	description: Mapped[str] = mapped_column(Text, default="")
	purpose: Mapped[str] = mapped_column(Text, default="")
	characteristics: Mapped[list] = mapped_column(JSON, default=list)
	structure: Mapped[list] = mapped_column(JSON, default=list)
	writing_guidelines: Mapped[list] = mapped_column(JSON, default=list)
	avoid: Mapped[list] = mapped_column(JSON, default=list)
	example_knowledge_item_ids: Mapped[list] = mapped_column(JSON, default=list)
	rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
	is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

	user: Mapped[User] = relationship(back_populates="knowledge_approaches")
	knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(back_populates="approach")


class KnowledgeItem(Base):
	__tablename__ = "knowledge_items"
	__table_args__ = (
		UniqueConstraint("user_id", "source_message_id", name="uq_knowledge_user_source_message"),
		UniqueConstraint("user_id", "source_file_id", name="uq_knowledge_user_source_file"),
		CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_knowledge_item_rating"),
		Index("ix_knowledge_user_active", "user_id", "is_active"),
		Index("ix_knowledge_user_source", "user_id", "source_type"),
		Index("ix_knowledge_user_rating", "user_id", "rating"),
		Index("ix_knowledge_user_created", "user_id", "created_at", "id"),
		Index("ix_knowledge_user_updated", "user_id", "updated_at", "id"),
		Index("ix_knowledge_user_active_approach", "user_id", "is_active", "approach_id"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
	approach_id: Mapped[str | None] = mapped_column(ForeignKey("knowledge_approaches.id", ondelete="SET NULL"), nullable=True, index=True)
	source_type: Mapped[str] = mapped_column(String(32))
	source_message_id: Mapped[str | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
	source_file_id: Mapped[str | None] = mapped_column(ForeignKey("attachments.id", ondelete="SET NULL"), nullable=True)
	title: Mapped[str] = mapped_column(String(255))
	content: Mapped[str] = mapped_column(Text, default="")
	mime_type: Mapped[str] = mapped_column(String(160), default="text/plain")
	original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
	storage_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
	storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
	current_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
	current_mime_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
	current_storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
	rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
	is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
	item_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
	deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

	user: Mapped[User] = relationship(back_populates="knowledge_items")
	approach: Mapped[KnowledgeApproach | None] = relationship(back_populates="knowledge_items", lazy="joined")
	source_message: Mapped[Message | None] = relationship(back_populates="knowledge_items")
	source_file: Mapped[Attachment | None] = relationship(back_populates="knowledge_items")
