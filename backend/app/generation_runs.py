from __future__ import annotations

import re

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import Conversation, GenerationRun, GenerationRunStatus, Message, utc_now


TERMINAL_GENERATION_STATUSES = frozenset({
	GenerationRunStatus.COMPLETED,
	GenerationRunStatus.FAILED,
	GenerationRunStatus.STOPPED,
	GenerationRunStatus.INTERRUPTED,
})
ACTIVE_GENERATION_STATUSES = frozenset({
	GenerationRunStatus.QUEUED,
	GenerationRunStatus.RUNNING,
})
ALLOWED_GENERATION_TRANSITIONS: dict[GenerationRunStatus, frozenset[GenerationRunStatus]] = {
	GenerationRunStatus.QUEUED: frozenset({
		GenerationRunStatus.RUNNING,
		GenerationRunStatus.FAILED,
		GenerationRunStatus.STOPPED,
		GenerationRunStatus.INTERRUPTED,
	}),
	GenerationRunStatus.RUNNING: TERMINAL_GENERATION_STATUSES,
	GenerationRunStatus.COMPLETED: frozenset(),
	GenerationRunStatus.FAILED: frozenset(),
	GenerationRunStatus.STOPPED: frozenset(),
	GenerationRunStatus.INTERRUPTED: frozenset(),
}

_SAFE_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class GenerationRunError(RuntimeError):
	pass


class GenerationRunNotFound(GenerationRunError):
	pass


class GenerationRunScopeError(GenerationRunError):
	pass


class GenerationRunConflict(GenerationRunError):
	pass


class InvalidGenerationRunTransition(GenerationRunError):
	pass


def _normalize_required(value: str, *, field: str, maximum: int) -> str:
	normalized = value.strip()
	if not normalized or len(normalized) > maximum:
		raise ValueError(f"{field} must contain between 1 and {maximum} characters")
	return normalized


def _normalize_optional(value: str | None, *, field: str, maximum: int) -> str | None:
	if value is None:
		return None
	normalized = value.strip()
	if not normalized:
		return None
	if len(normalized) > maximum:
		raise ValueError(f"{field} must not exceed {maximum} characters")
	return normalized


def _normalize_error_code(error_code: str | None) -> str | None:
	if error_code is None:
		return None
	normalized = error_code.strip().upper()
	if not _SAFE_ERROR_CODE.fullmatch(normalized):
		raise ValueError("error_code must be an uppercase safe identifier")
	return normalized


def _detach(db: Session, run: GenerationRun) -> GenerationRun:
	db.refresh(run)
	db.expunge(run)
	return run


def _validate_message_scope(
	db: Session,
	*,
	user_id: str,
	conversation_id: str,
	branch_anchor_message_id: str,
	assistant_message_id: str | None,
) -> None:
	conversation = db.scalar(select(Conversation).where(
		Conversation.id == conversation_id,
		Conversation.user_id == user_id,
	))
	if conversation is None:
		raise GenerationRunScopeError("Conversation does not belong to the generation owner")

	branch_message = db.scalar(select(Message).where(
		Message.id == branch_anchor_message_id,
		Message.conversation_id == conversation_id,
	))
	if branch_message is None or branch_message.role != "user":
		raise GenerationRunScopeError("Branch anchor must be a user message in the conversation")

	if assistant_message_id is None:
		return
	assistant_message = db.scalar(select(Message).where(
		Message.id == assistant_message_id,
		Message.conversation_id == conversation_id,
	))
	if (
		assistant_message is None
		or assistant_message.role != "assistant"
		or assistant_message.reply_to_id != branch_anchor_message_id
	):
		raise GenerationRunScopeError("Assistant message must reply to the branch anchor")


def _find_by_idempotency_key(db: Session, user_id: str, idempotency_key: str) -> GenerationRun | None:
	return db.scalar(select(GenerationRun).where(
		GenerationRun.user_id == user_id,
		GenerationRun.idempotency_key == idempotency_key,
	))


def _find_conflicting_active_run(
	db: Session,
	*,
	user_id: str,
	conversation_id: str,
	branch_anchor_message_id: str,
) -> GenerationRun | None:
	branch_anchor = db.get(Message, branch_anchor_message_id)
	parent_assistant_id = branch_anchor.reply_to_id if branch_anchor is not None else None
	branch_conflict = GenerationRun.branch_anchor_message_id == branch_anchor_message_id
	if parent_assistant_id is not None:
		branch_conflict = branch_conflict | (GenerationRun.assistant_message_id == parent_assistant_id)
	return db.scalar(select(GenerationRun).where(
		GenerationRun.user_id == user_id,
		GenerationRun.conversation_id == conversation_id,
		GenerationRun.status.in_(ACTIVE_GENERATION_STATUSES),
		branch_conflict,
	))


def _validate_idempotent_scope(
	run: GenerationRun,
	*,
	conversation_id: str,
	branch_anchor_message_id: str,
	assistant_message_id: str | None,
) -> None:
	if (
		run.conversation_id != conversation_id
		or run.branch_anchor_message_id != branch_anchor_message_id
		or run.assistant_message_id != assistant_message_id
	):
		raise GenerationRunConflict("Idempotency key is already bound to another generation scope")


def create_generation_run(
	*,
	user_id: str,
	conversation_id: str,
	branch_anchor_message_id: str,
	idempotency_key: str,
	assistant_message_id: str | None = None,
	provider: str | None = None,
	model: str | None = None,
	correlation_id: str | None = None,
) -> GenerationRun:
	key = _normalize_required(idempotency_key, field="idempotency_key", maximum=128)
	provider_value = _normalize_optional(provider, field="provider", maximum=32)
	model_value = _normalize_optional(model, field="model", maximum=160)
	correlation_value = _normalize_optional(correlation_id, field="correlation_id", maximum=128)
	with SessionLocal() as db:
		try:
			_validate_message_scope(
				db,
				user_id=user_id,
				conversation_id=conversation_id,
				branch_anchor_message_id=branch_anchor_message_id,
				assistant_message_id=assistant_message_id,
			)
			if _find_conflicting_active_run(
				db,
				user_id=user_id,
				conversation_id=conversation_id,
				branch_anchor_message_id=branch_anchor_message_id,
			) is not None:
				raise GenerationRunConflict("An active GenerationRun already exists for this branch")
			run = GenerationRun(
				user_id=user_id,
				conversation_id=conversation_id,
				branch_anchor_message_id=branch_anchor_message_id,
				assistant_message_id=assistant_message_id,
				idempotency_key=key,
				provider=provider_value,
				model=model_value,
				correlation_id=correlation_value,
				status=GenerationRunStatus.QUEUED,
			)
			db.add(run)
			db.commit()
			return _detach(db, run)
		except IntegrityError as error:
			db.rollback()
			raise GenerationRunConflict("GenerationRun already exists for this idempotency key or assistant message") from error
		except Exception:
			db.rollback()
			raise


def get_or_create_generation_run(
	*,
	user_id: str,
	conversation_id: str,
	branch_anchor_message_id: str,
	idempotency_key: str,
	assistant_message_id: str | None = None,
	provider: str | None = None,
	model: str | None = None,
	correlation_id: str | None = None,
) -> tuple[GenerationRun, bool]:
	key = _normalize_required(idempotency_key, field="idempotency_key", maximum=128)
	with SessionLocal() as db:
		existing = _find_by_idempotency_key(db, user_id, key)
		if existing is not None:
			_validate_idempotent_scope(
				existing,
				conversation_id=conversation_id,
				branch_anchor_message_id=branch_anchor_message_id,
				assistant_message_id=assistant_message_id,
			)
			return _detach(db, existing), False

	try:
		return create_generation_run(
			user_id=user_id,
			conversation_id=conversation_id,
			branch_anchor_message_id=branch_anchor_message_id,
			assistant_message_id=assistant_message_id,
			idempotency_key=key,
			provider=provider,
			model=model,
			correlation_id=correlation_id,
		), True
	except GenerationRunConflict:
		with SessionLocal() as db:
			existing = _find_by_idempotency_key(db, user_id, key)
			if existing is None:
				raise
			_validate_idempotent_scope(
				existing,
				conversation_id=conversation_id,
				branch_anchor_message_id=branch_anchor_message_id,
				assistant_message_id=assistant_message_id,
			)
			return _detach(db, existing), False


def get_generation_run(*, user_id: str, run_id: str) -> GenerationRun:
	with SessionLocal() as db:
		run = db.scalar(select(GenerationRun).where(
			GenerationRun.id == run_id,
			GenerationRun.user_id == user_id,
		))
		if run is None:
			raise GenerationRunNotFound("GenerationRun was not found for this user")
		return _detach(db, run)


def get_generation_run_by_idempotency_key(*, user_id: str, idempotency_key: str) -> GenerationRun | None:
	key = _normalize_required(idempotency_key, field="idempotency_key", maximum=128)
	with SessionLocal() as db:
		run = _find_by_idempotency_key(db, user_id, key)
		return _detach(db, run) if run is not None else None


def get_generation_run_by_assistant_message(*, user_id: str, assistant_message_id: str) -> GenerationRun | None:
	message_id = _normalize_required(assistant_message_id, field="assistant_message_id", maximum=36)
	with SessionLocal() as db:
		run = db.scalar(select(GenerationRun).where(
			GenerationRun.user_id == user_id,
			GenerationRun.assistant_message_id == message_id,
		))
		return _detach(db, run) if run is not None else None


def list_active_generation_runs(
	*,
	user_id: str,
	conversation_id: str | None = None,
	branch_anchor_message_id: str | None = None,
) -> list[GenerationRun]:
	filters = [
		GenerationRun.user_id == user_id,
		GenerationRun.status.in_(ACTIVE_GENERATION_STATUSES),
	]
	if conversation_id is not None:
		filters.append(GenerationRun.conversation_id == conversation_id)
	if branch_anchor_message_id is not None:
		filters.append(GenerationRun.branch_anchor_message_id == branch_anchor_message_id)
	with SessionLocal() as db:
		runs = list(db.scalars(
			select(GenerationRun)
			.where(*filters)
			.order_by(GenerationRun.created_at, GenerationRun.id)
		))
		for run in runs:
			db.expunge(run)
		return runs


def interrupt_orphaned_generation_runs() -> list[str]:
	"""Finalize runs left active by the previous single-worker process.

	This recovery deliberately assumes exactly one backend worker. Without a
	distributed lease, calling it from multiple live workers would let one worker
	interrupt another worker's tasks.
	"""
	with SessionLocal() as db:
		runs = list(db.scalars(select(GenerationRun).where(
			GenerationRun.status.in_(ACTIVE_GENERATION_STATUSES),
		)))
		if not runs:
			return []
		now = utc_now()
		run_ids = [run.id for run in runs]
		assistant_ids = [run.assistant_message_id for run in runs if run.assistant_message_id]
		db.execute(
			update(GenerationRun)
			.where(GenerationRun.id.in_(run_ids))
			.values(
				status=GenerationRunStatus.INTERRUPTED,
				error_code=None,
				updated_at=now,
				finished_at=now,
			)
		)
		if assistant_ids:
			db.execute(
				update(Message)
				.where(Message.id.in_(assistant_ids))
				.values(status="cancelled", error_code=None)
			)
		db.commit()
		return run_ids


def transition_generation_run(
	*,
	user_id: str,
	run_id: str,
	status: GenerationRunStatus | str,
	error_code: str | None = None,
) -> tuple[GenerationRun, bool]:
	target = GenerationRunStatus(status)
	if target != GenerationRunStatus.FAILED and error_code is not None:
		raise ValueError("error_code is only valid for failed generations")
	safe_error_code = _normalize_error_code(error_code) if target == GenerationRunStatus.FAILED else None

	with SessionLocal() as db:
		current = db.scalar(select(GenerationRun).where(
			GenerationRun.id == run_id,
			GenerationRun.user_id == user_id,
		))
		if current is None:
			raise GenerationRunNotFound("GenerationRun was not found for this user")
		if current.status == target:
			return _detach(db, current), False
		if target not in ALLOWED_GENERATION_TRANSITIONS[current.status]:
			raise InvalidGenerationRunTransition(f"Cannot transition {current.status.value} to {target.value}")

		now = utc_now()
		values: dict[str, object] = {
			"status": target,
			"updated_at": now,
		}
		if target == GenerationRunStatus.RUNNING:
			values["started_at"] = now
		if target in TERMINAL_GENERATION_STATUSES:
			values["finished_at"] = now
			values["error_code"] = safe_error_code

		result = db.execute(
			update(GenerationRun)
			.where(
				GenerationRun.id == run_id,
				GenerationRun.user_id == user_id,
				GenerationRun.status == current.status,
			)
			.values(**values)
		)
		if result.rowcount == 1:
			db.commit()
			updated = db.scalar(select(GenerationRun).where(GenerationRun.id == run_id))
			if updated is None:
				raise GenerationRunNotFound("GenerationRun disappeared after transition")
			return _detach(db, updated), True

		db.rollback()
		latest = db.scalar(select(GenerationRun).where(
			GenerationRun.id == run_id,
			GenerationRun.user_id == user_id,
		))
		if latest is None:
			raise GenerationRunNotFound("GenerationRun was not found after concurrent transition")
		if latest.status == target:
			return _detach(db, latest), False
		raise InvalidGenerationRunTransition(
			f"GenerationRun already transitioned to {latest.status.value}",
		)


def start_generation_run(*, user_id: str, run_id: str) -> tuple[GenerationRun, bool]:
	return transition_generation_run(
		user_id=user_id,
		run_id=run_id,
		status=GenerationRunStatus.RUNNING,
	)


def finish_generation_run(
	*,
	user_id: str,
	run_id: str,
	status: GenerationRunStatus | str,
	error_code: str | None = None,
) -> tuple[GenerationRun, bool]:
	target = GenerationRunStatus(status)
	if target not in TERMINAL_GENERATION_STATUSES:
		raise ValueError("finish_generation_run requires a terminal status")
	return transition_generation_run(
		user_id=user_id,
		run_id=run_id,
		status=target,
		error_code=error_code,
	)


def _finalize_generation_run_in_session(
	db: Session,
	*,
	user_id: str,
	run_id: str,
	status: GenerationRunStatus,
	assistant_content: str,
	error_code: str | None,
	request_id: str | None,
) -> tuple[GenerationRun, bool]:
	if status not in TERMINAL_GENERATION_STATUSES:
		raise ValueError("finalize_generation_run requires a terminal status")
	if status != GenerationRunStatus.FAILED and error_code is not None:
		raise ValueError("error_code is only valid for failed generations")
	safe_error_code = _normalize_error_code(error_code) if status == GenerationRunStatus.FAILED else None

	current = db.scalar(select(GenerationRun).where(
		GenerationRun.id == run_id,
		GenerationRun.user_id == user_id,
	))
	if current is None:
		db.rollback()
		raise GenerationRunNotFound("GenerationRun was not found for this user")
	if current.status == status:
		db.rollback()
		current = db.scalar(select(GenerationRun).where(
			GenerationRun.id == run_id,
			GenerationRun.user_id == user_id,
		))
		if current is None:
			raise GenerationRunNotFound("GenerationRun disappeared during finalization")
		return _detach(db, current), False
	if status not in ALLOWED_GENERATION_TRANSITIONS[current.status]:
		db.rollback()
		raise InvalidGenerationRunTransition(f"Cannot transition {current.status.value} to {status.value}")
	assistant = db.scalar(select(Message).where(
		Message.id == current.assistant_message_id,
		Message.conversation_id == current.conversation_id,
	)) if current.assistant_message_id is not None else None
	if status == GenerationRunStatus.COMPLETED and (assistant is None or assistant.role != "assistant"):
		db.rollback()
		raise GenerationRunScopeError("GenerationRun assistant message is unavailable")

	now = utc_now()
	result = db.execute(
		update(GenerationRun)
		.where(
			GenerationRun.id == run_id,
			GenerationRun.user_id == user_id,
			GenerationRun.status == current.status,
		)
		.values(
			status=status,
			error_code=safe_error_code,
			updated_at=now,
			finished_at=now,
		)
	)
	if result.rowcount != 1:
		db.rollback()
		latest = db.scalar(select(GenerationRun).where(
			GenerationRun.id == run_id,
			GenerationRun.user_id == user_id,
		))
		if latest is None:
			raise GenerationRunNotFound("GenerationRun was not found after concurrent finalization")
		if latest.status == status:
			return _detach(db, latest), False
		raise InvalidGenerationRunTransition(
			f"GenerationRun already transitioned to {latest.status.value}",
		)

	if assistant is not None and assistant.role == "assistant":
		assistant.content = assistant_content
		assistant.status = {
			GenerationRunStatus.COMPLETED: "done",
			GenerationRunStatus.FAILED: "error",
			GenerationRunStatus.STOPPED: "cancelled",
			GenerationRunStatus.INTERRUPTED: "cancelled",
		}[status]
		assistant.error_code = safe_error_code
		assistant.request_id = request_id
	db.commit()
	updated = db.scalar(select(GenerationRun).where(GenerationRun.id == run_id))
	if updated is None:
		raise GenerationRunNotFound("GenerationRun disappeared after finalization")
	return _detach(db, updated), True


def finalize_generation_run(
	*,
	user_id: str,
	run_id: str,
	status: GenerationRunStatus | str,
	assistant_content: str,
	error_code: str | None = None,
	request_id: str | None = None,
	db: Session | None = None,
) -> tuple[GenerationRun, bool]:
	"""Atomically finalize a run and its assistant message.

	When ``db`` is supplied, pending response attachments are committed in the
	same transaction. The caller must not share that session with another task.
	"""
	target = GenerationRunStatus(status)
	if db is not None:
		return _finalize_generation_run_in_session(
			db,
			user_id=user_id,
			run_id=run_id,
			status=target,
			assistant_content=assistant_content,
			error_code=error_code,
			request_id=request_id,
		)
	with SessionLocal() as owned_db:
		return _finalize_generation_run_in_session(
			owned_db,
			user_id=user_id,
			run_id=run_id,
			status=target,
			assistant_content=assistant_content,
			error_code=error_code,
			request_id=request_id,
		)
