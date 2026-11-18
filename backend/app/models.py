from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum as SQLAlchemyEnum, Float, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .roles import UserRole


def utc_now() -> datetime:
	return datetime.now(timezone.utc)


def new_id() -> str:
	return str(uuid4())


class User(Base):
	__tablename__ = "users"
	__table_args__ = (
		CheckConstraint("role IN ('user', 'admin', 'owner')", name="ck_users_role"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
	login: Mapped[str] = mapped_column(String(80), unique=True, index=True)
	password_hash: Mapped[str] = mapped_column(String(255))
	role: Mapped[UserRole] = mapped_column(
		SQLAlchemyEnum(
			UserRole,
			name="user_role",
			native_enum=False,
			create_constraint=False,
			values_callable=lambda roles: [role.value for role in roles],
		),
		default=UserRole.USER,
		server_default=UserRole.USER.value,
	)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

	conversations: Mapped[list["Conversation"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	ratings: Mapped[list["MessageRating"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	knowledge_approaches: Mapped[list["KnowledgeApproach"]] = relationship(back_populates="user", cascade="all, delete-orphan")
	structured_memory_items: Mapped[list["StructuredMemoryItem"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class RoleChangeAudit(Base):
	__tablename__ = "role_change_audits"
	__table_args__ = (
		CheckConstraint("old_role IN ('user', 'admin', 'owner')", name="ck_role_change_audits_old_role"),
		CheckConstraint("new_role IN ('user', 'admin', 'owner')", name="ck_role_change_audits_new_role"),
		Index("ix_role_change_audits_actor_created", "actor_user_id", "created_at"),
		Index("ix_role_change_audits_target_created", "target_user_id", "created_at"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	actor_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
	target_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
	old_role: Mapped[UserRole] = mapped_column(
		SQLAlchemyEnum(
			UserRole,
			name="role_change_audit_old_role",
			native_enum=False,
			create_constraint=False,
			values_callable=lambda roles: [role.value for role in roles],
		)
	)
	new_role: Mapped[UserRole] = mapped_column(
		SQLAlchemyEnum(
			UserRole,
			name="role_change_audit_new_role",
			native_enum=False,
			create_constraint=False,
			values_callable=lambda roles: [role.value for role in roles],
		)
	)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
	correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)


class AIUsageEvent(Base):
	__tablename__ = "ai_usage_events"
	__table_args__ = (
		CheckConstraint("status IN ('success', 'error', 'cancelled')", name="ck_ai_usage_events_status"),
		Index("ix_ai_usage_events_user_created", "user_id", "created_at"),
		Index("ix_ai_usage_events_model_created", "provider", "model", "created_at"),
		Index("ix_ai_usage_events_status_created", "status", "created_at"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
	conversation_id: Mapped[str | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True)
	correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
	purpose: Mapped[str] = mapped_column(String(64))
	task_type: Mapped[str] = mapped_column(String(32))
	provider: Mapped[str] = mapped_column(String(32))
	model: Mapped[str] = mapped_column(String(160))
	prompt_version: Mapped[str] = mapped_column(String(64))
	reasoning_effort: Mapped[str | None] = mapped_column(String(32), nullable=True)
	status: Mapped[str] = mapped_column(String(16))
	input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
	output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
	cached_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
	total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
	latency_ms: Mapped[float] = mapped_column(Float)
	estimated_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 8), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


class ActivityEvent(Base):
	__tablename__ = "activity_events"
	__table_args__ = (
		Index("ix_activity_events_user_created", "user_id", "created_at"),
		Index("ix_activity_events_type_created", "event_type", "created_at"),
		Index("ix_activity_events_resource", "resource_type", "resource_id"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
	event_type: Mapped[str] = mapped_column(String(80))
	resource_type: Mapped[str] = mapped_column(String(48))
	resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
	status: Mapped[str] = mapped_column(String(24))
	correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


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
	branch_summaries: Mapped[list["BranchSummary"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


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
	model_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
	branch_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
	reply_to_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
	is_active: Mapped[bool] = mapped_column(Boolean, default=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

	conversation: Mapped[Conversation] = relationship(back_populates="messages")
	attachments: Mapped[list["Attachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")
	ratings: Mapped[list["MessageRating"]] = relationship(back_populates="message", cascade="all, delete-orphan")
	knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(back_populates="source_message")


class BranchSummary(Base):
	__tablename__ = "branch_summaries"
	__table_args__ = (
		UniqueConstraint(
			"conversation_id",
			"branch_anchor_message_id",
			"summarized_through_message_id",
			name="uq_branch_summary_scope",
		),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
	branch_anchor_message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
	summarized_through_message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
	summary_text: Mapped[str] = mapped_column(Text)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

	conversation: Mapped[Conversation] = relationship(back_populates="branch_summaries")


class StructuredMemoryItem(Base):
	__tablename__ = "structured_memory_items"
	__table_args__ = (
		UniqueConstraint("user_id", "category", "name", name="uq_structured_memory_user_category_name"),
		CheckConstraint(
			"category IN ('project', 'preferences', 'decisions')",
			name="ck_structured_memory_category",
		),
		CheckConstraint(
			"(category = 'decisions' AND name IS NULL) OR "
			"(category IN ('project', 'preferences') AND name IS NOT NULL)",
			name="ck_structured_memory_name",
		),
		Index("ix_structured_memory_user_category", "user_id", "category"),
	)

	id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
	user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
	category: Mapped[str] = mapped_column(String(16))
	name: Mapped[str | None] = mapped_column(String(160), nullable=True)
	value: Mapped[object] = mapped_column(JSON)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

	user: Mapped[User] = relationship(back_populates="structured_memory_items")


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
