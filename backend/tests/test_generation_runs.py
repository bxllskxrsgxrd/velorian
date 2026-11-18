from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.auth import hash_password
from app.database import SessionLocal
from app.generation_runs import (
	GenerationRunConflict,
	GenerationRunNotFound,
	GenerationRunScopeError,
	InvalidGenerationRunTransition,
	create_generation_run,
	finish_generation_run,
	get_generation_run,
	get_or_create_generation_run,
	list_active_generation_runs,
	start_generation_run,
)
from app.models import Conversation, GenerationRun, GenerationRunStatus, Message, User


@pytest.fixture(autouse=True)
def _initialized_test_database(client):
	yield


def _branch_fixture(prefix: str = "generation") -> dict[str, str]:
	marker = uuid4().hex[:10]
	with SessionLocal() as db:
		user = User(
			login=f"{prefix}-{marker}",
			email=f"{prefix}-{marker}@example.com",
			password_hash=hash_password("strong-password"),
		)
		db.add(user)
		db.flush()
		conversation = Conversation(user_id=user.id, title="Generation lifecycle")
		db.add(conversation)
		db.flush()

		branch_one_id = str(uuid4())
		branch_two_id = str(uuid4())
		assistant_one_id = str(uuid4())
		assistant_two_id = str(uuid4())
		db.add_all([
			Message(
				id=branch_one_id,
				conversation_id=conversation.id,
				role="user",
				content="Branch one",
				branch_group_id=branch_one_id,
			),
			Message(
				id=assistant_one_id,
				conversation_id=conversation.id,
				role="assistant",
				content="",
				status="streaming",
				reply_to_id=branch_one_id,
			),
			Message(
				id=branch_two_id,
				conversation_id=conversation.id,
				role="user",
				content="Branch two",
				branch_group_id=branch_two_id,
			),
			Message(
				id=assistant_two_id,
				conversation_id=conversation.id,
				role="assistant",
				content="",
				status="streaming",
				reply_to_id=branch_two_id,
			),
		])
		db.commit()
		return {
			"user_id": user.id,
			"conversation_id": conversation.id,
			"branch_one_id": branch_one_id,
			"branch_two_id": branch_two_id,
			"assistant_one_id": assistant_one_id,
			"assistant_two_id": assistant_two_id,
		}


def _create(scope: dict[str, str], key: str, *, branch: str = "one", assistant: bool = True) -> GenerationRun:
	return create_generation_run(
		user_id=scope["user_id"],
		conversation_id=scope["conversation_id"],
		branch_anchor_message_id=scope[f"branch_{branch}_id"],
		assistant_message_id=scope[f"assistant_{branch}_id"] if assistant else None,
		idempotency_key=key,
		provider="groq",
		model="test-model",
		correlation_id=f"correlation-{key}",
	)


def test_create_generation_run_with_branch_and_message_binding():
	scope = _branch_fixture()
	run = _create(scope, f"create-{uuid4()}")

	assert run.user_id == scope["user_id"]
	assert run.conversation_id == scope["conversation_id"]
	assert run.branch_anchor_message_id == scope["branch_one_id"]
	assert run.assistant_message_id == scope["assistant_one_id"]
	assert run.status == GenerationRunStatus.QUEUED
	assert run.provider == "groq"
	assert run.model == "test-model"
	assert run.created_at is not None
	assert run.updated_at is not None
	assert run.started_at is None
	assert run.finished_at is None
	assert run.error_code is None


def test_generation_run_transitions_are_consistent_and_terminal_is_immutable():
	scope = _branch_fixture()
	run = _create(scope, f"lifecycle-{uuid4()}")

	running, changed = start_generation_run(user_id=scope["user_id"], run_id=run.id)
	assert changed is True
	assert running.status == GenerationRunStatus.RUNNING
	assert running.started_at is not None
	assert running.finished_at is None
	repeated_running, changed = start_generation_run(user_id=scope["user_id"], run_id=run.id)
	assert changed is False
	assert repeated_running.started_at == running.started_at

	completed, changed = finish_generation_run(
		user_id=scope["user_id"],
		run_id=run.id,
		status=GenerationRunStatus.COMPLETED,
	)
	assert changed is True
	assert completed.status == GenerationRunStatus.COMPLETED
	assert completed.started_at == running.started_at
	assert completed.finished_at is not None

	repeated, changed = finish_generation_run(
		user_id=scope["user_id"],
		run_id=run.id,
		status=GenerationRunStatus.COMPLETED,
	)
	assert changed is False
	assert repeated.finished_at == completed.finished_at

	with pytest.raises(InvalidGenerationRunTransition):
		finish_generation_run(
			user_id=scope["user_id"],
			run_id=run.id,
			status=GenerationRunStatus.FAILED,
			error_code="AI_SERVICE_ERROR",
		)
	with pytest.raises(InvalidGenerationRunTransition):
		start_generation_run(user_id=scope["user_id"], run_id=run.id)


def test_failed_completion_is_idempotent_and_preserves_first_safe_error():
	scope = _branch_fixture()
	run = _create(scope, f"failed-{uuid4()}", assistant=False)
	failed, changed = finish_generation_run(
		user_id=scope["user_id"],
		run_id=run.id,
		status="failed",
		error_code="ai_service_error",
	)
	assert changed is True
	assert failed.status == GenerationRunStatus.FAILED
	assert failed.started_at is None
	assert failed.finished_at is not None
	assert failed.error_code == "AI_SERVICE_ERROR"

	repeated, changed = finish_generation_run(
		user_id=scope["user_id"],
		run_id=run.id,
		status="failed",
		error_code="OTHER_ERROR",
	)
	assert changed is False
	assert repeated.error_code == "AI_SERVICE_ERROR"
	assert repeated.finished_at == failed.finished_at

	with pytest.raises(ValueError):
		finish_generation_run(
			user_id=scope["user_id"],
			run_id=run.id,
			status="failed",
			error_code="unsafe error text",
		)


def test_queued_generation_can_stop_or_interrupt_but_cannot_complete():
	scope = _branch_fixture()
	for terminal_status in (GenerationRunStatus.STOPPED, GenerationRunStatus.INTERRUPTED):
		run = _create(scope, f"queued-{terminal_status.value}-{uuid4()}", assistant=False)
		finished, changed = finish_generation_run(
			user_id=scope["user_id"],
			run_id=run.id,
			status=terminal_status,
		)
		assert changed is True
		assert finished.status == terminal_status
		assert finished.started_at is None
		assert finished.finished_at is not None

	queued = _create(scope, f"queued-completed-{uuid4()}", assistant=False)
	with pytest.raises(InvalidGenerationRunTransition):
		finish_generation_run(
			user_id=scope["user_id"],
			run_id=queued.id,
			status=GenerationRunStatus.COMPLETED,
		)


def test_get_or_create_is_idempotent_and_rejects_scope_reuse():
	scope = _branch_fixture()
	key = f"idempotent-{uuid4()}"
	first, created = get_or_create_generation_run(
		user_id=scope["user_id"],
		conversation_id=scope["conversation_id"],
		branch_anchor_message_id=scope["branch_one_id"],
		assistant_message_id=scope["assistant_one_id"],
		idempotency_key=key,
	)
	second, created_again = get_or_create_generation_run(
		user_id=scope["user_id"],
		conversation_id=scope["conversation_id"],
		branch_anchor_message_id=scope["branch_one_id"],
		assistant_message_id=scope["assistant_one_id"],
		idempotency_key=key,
	)
	assert created is True
	assert created_again is False
	assert second.id == first.id

	with pytest.raises(GenerationRunConflict):
		get_or_create_generation_run(
			user_id=scope["user_id"],
			conversation_id=scope["conversation_id"],
			branch_anchor_message_id=scope["branch_two_id"],
			assistant_message_id=scope["assistant_two_id"],
			idempotency_key=key,
		)


def test_concurrent_get_or_create_persists_one_generation():
	scope = _branch_fixture()
	key = f"concurrent-{uuid4()}"
	barrier = Barrier(2)

	def create_once():
		barrier.wait()
		return get_or_create_generation_run(
			user_id=scope["user_id"],
			conversation_id=scope["conversation_id"],
			branch_anchor_message_id=scope["branch_one_id"],
			assistant_message_id=scope["assistant_one_id"],
			idempotency_key=key,
		)

	with ThreadPoolExecutor(max_workers=2) as executor:
		results = list(executor.map(lambda _index: create_once(), range(2)))

	assert len({run.id for run, _created in results}) == 1
	assert sum(1 for _run, created in results if created) == 1
	with SessionLocal() as db:
		count = db.scalar(select(func.count(GenerationRun.id)).where(
			GenerationRun.user_id == scope["user_id"],
			GenerationRun.idempotency_key == key,
		))
	assert count == 1


def test_user_and_branch_isolation_and_active_queries():
	first_scope = _branch_fixture("generation-first")
	second_scope = _branch_fixture("generation-second")
	first = _create(first_scope, f"branch-one-{uuid4()}", branch="one")
	second = _create(first_scope, f"branch-two-{uuid4()}", branch="two")
	foreign = _create(second_scope, f"foreign-{uuid4()}", branch="one")

	with pytest.raises(GenerationRunNotFound):
		get_generation_run(user_id=second_scope["user_id"], run_id=first.id)
	with pytest.raises(GenerationRunScopeError):
		create_generation_run(
			user_id=second_scope["user_id"],
			conversation_id=first_scope["conversation_id"],
			branch_anchor_message_id=first_scope["branch_one_id"],
			idempotency_key=f"cross-user-{uuid4()}",
		)
	with pytest.raises(GenerationRunScopeError):
		create_generation_run(
			user_id=first_scope["user_id"],
			conversation_id=first_scope["conversation_id"],
			branch_anchor_message_id=first_scope["branch_one_id"],
			assistant_message_id=first_scope["assistant_two_id"],
			idempotency_key=f"wrong-assistant-{uuid4()}",
		)

	branch_one_runs = list_active_generation_runs(
		user_id=first_scope["user_id"],
		conversation_id=first_scope["conversation_id"],
		branch_anchor_message_id=first_scope["branch_one_id"],
	)
	assert [run.id for run in branch_one_runs] == [first.id]
	assert second.id not in {run.id for run in branch_one_runs}
	assert foreign.id not in {run.id for run in branch_one_runs}

	finish_generation_run(
		user_id=first_scope["user_id"],
		run_id=first.id,
		status="stopped",
	)
	assert list_active_generation_runs(
		user_id=first_scope["user_id"],
		branch_anchor_message_id=first_scope["branch_one_id"],
	) == []


def test_competing_terminal_transitions_do_not_overwrite_each_other():
	scope = _branch_fixture()
	run = _create(scope, f"terminal-race-{uuid4()}")
	start_generation_run(user_id=scope["user_id"], run_id=run.id)
	barrier = Barrier(2)

	def finish(status: GenerationRunStatus):
		barrier.wait()
		try:
			result, _changed = finish_generation_run(
				user_id=scope["user_id"],
				run_id=run.id,
				status=status,
				error_code="AI_SERVICE_ERROR" if status == GenerationRunStatus.FAILED else None,
			)
			return result.status
		except InvalidGenerationRunTransition:
			return None

	with ThreadPoolExecutor(max_workers=2) as executor:
		results = list(executor.map(finish, (GenerationRunStatus.COMPLETED, GenerationRunStatus.FAILED)))

	stored = get_generation_run(user_id=scope["user_id"], run_id=run.id)
	assert stored.status in {GenerationRunStatus.COMPLETED, GenerationRunStatus.FAILED}
	assert results.count(stored.status) == 1
	assert results.count(None) == 1
	assert stored.finished_at is not None


def test_generation_service_releases_sqlite_write_transaction_before_return():
	scope = _branch_fixture()
	run = _create(scope, f"short-transaction-{uuid4()}")
	start_generation_run(user_id=scope["user_id"], run_id=run.id)

	with SessionLocal() as db:
		message = Message(
			conversation_id=scope["conversation_id"],
			role="user",
			content="Independent write after lifecycle update",
		)
		db.add(message)
		db.commit()
		assert message.id is not None
