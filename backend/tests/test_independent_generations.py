import asyncio
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.generation_runs import (
	GenerationRunConflict,
	InvalidGenerationRunTransition,
	finalize_generation_run,
	get_generation_run,
	get_or_create_generation_run,
	interrupt_orphaned_generation_runs,
	start_generation_run,
	finish_generation_run,
)
from app.models import AIUsageEvent, Conversation, GenerationRun, GenerationRunStatus, Message
from app.observability import drain_observability_writes


def _seed_generation(authenticated_client, *, title: str = "Independent generation") -> dict[str, str]:
	current_user = authenticated_client.get("/api/auth/me").json()["user"]
	conversation_id = authenticated_client.post(
		"/api/conversations",
		json={"title": title},
	).json()["conversation"]["id"]
	with SessionLocal() as db:
		user_message = Message(
			conversation_id=conversation_id,
			role="user",
			content="Continue independently",
			status="done",
			search_mode="none",
			model_id="gpt-oss-120b",
		)
		db.add(user_message)
		db.flush()
		user_message.branch_group_id = user_message.id
		assistant_message = Message(
			conversation_id=conversation_id,
			role="assistant",
			content="",
			status="streaming",
			reply_to_id=user_message.id,
			model_id="gpt-oss-120b",
		)
		db.add(assistant_message)
		db.commit()
		ids = {
			"user_id": current_user["id"],
			"conversation_id": conversation_id,
			"user_message_id": user_message.id,
			"assistant_message_id": assistant_message.id,
		}
	run, created = get_or_create_generation_run(
		user_id=ids["user_id"],
		conversation_id=conversation_id,
		branch_anchor_message_id=ids["user_message_id"],
		assistant_message_id=ids["assistant_message_id"],
		idempotency_key=f"direct:{ids['assistant_message_id']}",
		provider="groq",
		model="test-model",
		correlation_id=f"request:{ids['assistant_message_id']}",
	)
	assert created is True
	ids["run_id"] = run.id
	return ids


def _spec(main_module, ids: dict[str, str]):
	return main_module.ChatGenerationSpec(
		run_id=ids["run_id"],
		user_id=ids["user_id"],
		conversation_id=ids["conversation_id"],
		user_message_id=ids["user_message_id"],
		user_message_content="Continue independently",
		assistant_message_id=ids["assistant_message_id"],
		prompt="Continue independently",
		request_id=f"request:{ids['assistant_message_id']}",
		ai_messages=[{"role": "user", "content": "Continue independently"}],
		web_search=False,
		model=main_module.ChatModelSpec(
			id="test", name="Test", description="Test", provider="groq", provider_model="test-model",
		),
		task_type="chat",
		prompt_version="chat:test",
	)


def _run_worker(main_module, ids: dict[str, str]) -> list[dict]:
	events: list[dict] = []

	async def scenario():
		await main_module._execute_chat_generation(
			_spec(main_module, ids),
			lambda event: events.append(json.loads(event)),
			lambda: GenerationRunStatus.INTERRUPTED,
		)

	asyncio.run(scenario())
	return events


def test_sse_disconnect_does_not_cancel_generation_and_partial_result_is_saved(
	authenticated_client,
	monkeypatch,
):
	import app.main as main_module

	ids = _seed_generation(authenticated_client)
	release = asyncio.Event()
	provider_waiting = asyncio.Event()
	partial = "P" * (main_module.GENERATION_PARTIAL_SAVE_CHARS + 1)

	async def controlled_deltas(*_args, **_kwargs):
		yield partial
		provider_waiting.set()
		await release.wait()
		yield " complete"

	monkeypatch.setattr(main_module, "_stream_ai_deltas", controlled_deltas)

	async def scenario():
		spec = _spec(main_module, ids)
		queue = main_module.generation_task_manager.start(
			spec.run_id,
			lambda publish, cancel_status: main_module._execute_chat_generation(spec, publish, cancel_status),
		)
		response = main_module._generation_streaming_response(
			run_id=spec.run_id,
			queue=queue,
			meta_event=main_module._event("meta", assistantMessageId=spec.assistant_message_id),
		)
		iterator = response.body_iterator
		assert b'"type": "meta"' in await anext(iterator)
		await asyncio.wait_for(provider_waiting.wait(), timeout=1)
		with SessionLocal() as db:
			stored = db.get(Message, ids["assistant_message_id"])
			assert stored is not None
			assert stored.status == "streaming"
			assert stored.content == partial
			conversation = db.get(Conversation, ids["conversation_id"])
			conversation.title = "Concurrent write succeeded"
			db.commit()
		await iterator.aclose()
		assert main_module.generation_task_manager.has_task(spec.run_id)
		release.set()
		for _ in range(100):
			if not main_module.generation_task_manager.has_task(spec.run_id):
				break
			await asyncio.sleep(0.01)
		assert not main_module.generation_task_manager.has_task(spec.run_id)

	asyncio.run(scenario())
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == "done"
		assert message.content == f"{partial} complete"
	assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.COMPLETED


def test_explicit_stop_cancels_task_and_preserves_partial_text(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client)
	provider_waiting = asyncio.Event()
	partial = "S" * (main_module.GENERATION_PARTIAL_SAVE_CHARS + 1)

	async def blocked_deltas(*_args, **_kwargs):
		yield partial
		provider_waiting.set()
		await asyncio.Event().wait()

	monkeypatch.setattr(main_module, "_stream_ai_deltas", blocked_deltas)

	async def scenario():
		spec = _spec(main_module, ids)
		queue = main_module.generation_task_manager.start(
			spec.run_id,
			lambda publish, cancel_status: main_module._execute_chat_generation(spec, publish, cancel_status),
		)
		await asyncio.wait_for(provider_waiting.wait(), timeout=1)
		assert await main_module.generation_task_manager.cancel(spec.run_id, GenerationRunStatus.STOPPED)
		main_module.generation_task_manager.unsubscribe(spec.run_id, queue)

	asyncio.run(scenario())
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == "cancelled"
		assert message.content == partial
	assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.STOPPED


def test_completed_state_wins_stop_race_after_response_commit(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client, title="Completed stop race")
	memory_started = asyncio.Event()

	async def completed_stream(*_args, **_kwargs):
		yield "Committed answer"

	async def blocked_memory(*_args, **_kwargs):
		memory_started.set()
		await asyncio.Event().wait()

	monkeypatch.setattr(main_module, "_stream_ai_deltas", completed_stream)
	monkeypatch.setattr(main_module, "_extract_and_store_memory", blocked_memory)

	async def scenario():
		spec = _spec(main_module, ids)
		queue = main_module.generation_task_manager.start(
			spec.run_id,
			lambda publish, cancel_status: main_module._execute_chat_generation(spec, publish, cancel_status),
		)
		await asyncio.wait_for(memory_started.wait(), timeout=1)
		assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.COMPLETED
		assert await main_module.generation_task_manager.cancel(spec.run_id, GenerationRunStatus.STOPPED)
		main_module.generation_task_manager.unsubscribe(spec.run_id, queue)

	asyncio.run(scenario())
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == "done"
		assert message.content == "Committed answer"
	assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.COMPLETED


def test_repeated_request_id_reuses_message_run_usage_and_provider_call(authenticated_client, monkeypatch):
	import app.main as main_module

	class CountingCompletions:
		def __init__(self):
			self.calls = 0

		async def create(self, **kwargs):
			if not kwargs.get("stream"):
				return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])
			self.calls += 1

			async def chunks():
				yield SimpleNamespace(
					choices=[SimpleNamespace(delta=SimpleNamespace(content="Only once"))],
					usage=None,
				)
				yield SimpleNamespace(
					choices=[],
					usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2),
				)

			return chunks()

	completions = CountingCompletions()
	monkeypatch.setattr(main_module, "client", SimpleNamespace(chat=SimpleNamespace(completions=completions)))
	conversation_id = authenticated_client.post(
		"/api/conversations",
		json={"title": "Idempotent"},
	).json()["conversation"]["id"]
	headers = {"X-Request-ID": "same-chat-delivery"}
	first = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Generate once"},
		headers=headers,
	)
	second = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Generate once"},
		headers=headers,
	)
	assert '"type": "done"' in first.text
	assert '"type": "done"' in second.text
	assert completions.calls == 1
	authenticated_client.portal.call(drain_observability_writes)
	with SessionLocal() as db:
		assert db.scalar(select(func.count(Message.id)).where(Message.conversation_id == conversation_id)) == 2
		assert db.scalar(select(func.count(GenerationRun.id)).where(GenerationRun.conversation_id == conversation_id)) == 1
		assert db.scalar(select(func.count(AIUsageEvent.id)).where(
			AIUsageEvent.conversation_id == conversation_id,
			AIUsageEvent.purpose == "chat",
			AIUsageEvent.correlation_id == "same-chat-delivery",
		)) == 1


def test_provider_error_fails_generation_run(authenticated_client, monkeypatch):
	import app.main as main_module

	class FailingCompletions:
		async def create(self, **kwargs):
			if kwargs.get("stream"):
				raise RuntimeError("provider unavailable")
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])

	monkeypatch.setattr(
		main_module,
		"client",
		SimpleNamespace(chat=SimpleNamespace(completions=FailingCompletions())),
	)
	conversation_id = authenticated_client.post(
		"/api/conversations",
		json={"title": "Failure"},
	).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Fail safely"},
	)
	assert '"type": "error"' in response.text
	with SessionLocal() as db:
		run = db.scalar(select(GenerationRun).where(GenerationRun.conversation_id == conversation_id))
		assistant = db.scalar(select(Message).where(
			Message.conversation_id == conversation_id,
			Message.role == "assistant",
		))
		assert run is not None and run.status == GenerationRunStatus.FAILED
		assert run.error_code == "AI_ERROR"
		assert assistant is not None and assistant.status == "error"


def test_first_chunk_timeout_fails_run_without_dangling_state(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client, title="First chunk timeout")

	async def no_first_chunk(*_args, **_kwargs):
		await asyncio.Event().wait()
		yield "unreachable"

	monkeypatch.setattr(main_module, "_stream_ai_deltas", no_first_chunk)
	monkeypatch.setattr(main_module, "GENERATION_FIRST_CHUNK_TIMEOUT_SECONDS", 0.02)
	monkeypatch.setattr(main_module, "GENERATION_IDLE_TIMEOUT_SECONDS", 1.0)
	monkeypatch.setattr(main_module, "GENERATION_TOTAL_TIMEOUT_SECONDS", 1.0)
	events = _run_worker(main_module, ids)

	assert events[-1]["type"] == "error"
	assert events[-1]["code"] == "AI_FIRST_CHUNK_TIMEOUT"
	with SessionLocal() as db:
		run = db.get(GenerationRun, ids["run_id"])
		message = db.get(Message, ids["assistant_message_id"])
		assert run is not None and run.status == GenerationRunStatus.FAILED
		assert run.error_code == "AI_FIRST_CHUNK_TIMEOUT"
		assert message is not None and message.status == "error"
		assert message.error_code == "AI_FIRST_CHUNK_TIMEOUT"


def test_stream_idle_timeout_preserves_partial_response(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client, title="Idle timeout")
	partial = "Provider returned this partial response"

	async def stalled_stream(*_args, **_kwargs):
		yield partial
		await asyncio.Event().wait()

	monkeypatch.setattr(main_module, "_stream_ai_deltas", stalled_stream)
	monkeypatch.setattr(main_module, "GENERATION_FIRST_CHUNK_TIMEOUT_SECONDS", 1.0)
	monkeypatch.setattr(main_module, "GENERATION_IDLE_TIMEOUT_SECONDS", 0.02)
	monkeypatch.setattr(main_module, "GENERATION_TOTAL_TIMEOUT_SECONDS", 1.0)
	events = _run_worker(main_module, ids)

	assert events[-1]["code"] == "AI_STREAM_IDLE_TIMEOUT"
	with SessionLocal() as db:
		run = db.get(GenerationRun, ids["run_id"])
		message = db.get(Message, ids["assistant_message_id"])
		assert run is not None and run.status == GenerationRunStatus.FAILED
		assert run.error_code == "AI_STREAM_IDLE_TIMEOUT"
		assert message is not None and message.content == partial
		assert message.status == "error"


def test_total_generation_timeout_wins_over_active_stream(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client, title="Total timeout")

	async def slow_continuous_stream(*_args, **_kwargs):
		while True:
			await asyncio.sleep(0.01)
			yield "x"

	monkeypatch.setattr(main_module, "_stream_ai_deltas", slow_continuous_stream)
	monkeypatch.setattr(main_module, "GENERATION_FIRST_CHUNK_TIMEOUT_SECONDS", 1.0)
	monkeypatch.setattr(main_module, "GENERATION_IDLE_TIMEOUT_SECONDS", 1.0)
	monkeypatch.setattr(main_module, "GENERATION_TOTAL_TIMEOUT_SECONDS", 0.035)
	events = _run_worker(main_module, ids)

	assert events[-1]["code"] == "AI_GENERATION_TIMEOUT"
	with SessionLocal() as db:
		run = db.get(GenerationRun, ids["run_id"])
		message = db.get(Message, ids["assistant_message_id"])
		assert run is not None and run.status == GenerationRunStatus.FAILED
		assert run.error_code == "AI_GENERATION_TIMEOUT"
		assert message is not None and message.content


def test_generation_completes_before_configured_timeouts(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client, title="Before timeout")

	async def quick_stream(*_args, **_kwargs):
		yield "Completed safely"

	async def skip_memory(*_args, **_kwargs):
		return None

	monkeypatch.setattr(main_module, "_stream_ai_deltas", quick_stream)
	monkeypatch.setattr(main_module, "_extract_and_store_memory", skip_memory)
	monkeypatch.setattr(main_module, "GENERATION_FIRST_CHUNK_TIMEOUT_SECONDS", 0.1)
	monkeypatch.setattr(main_module, "GENERATION_IDLE_TIMEOUT_SECONDS", 0.1)
	monkeypatch.setattr(main_module, "GENERATION_TOTAL_TIMEOUT_SECONDS", 0.2)
	events = _run_worker(main_module, ids)

	assert events[-1]["type"] == "done"
	with SessionLocal() as db:
		run = db.get(GenerationRun, ids["run_id"])
		message = db.get(Message, ids["assistant_message_id"])
		assert run is not None and run.status == GenerationRunStatus.COMPLETED
		assert message is not None and message.status == "done"
		assert message.content == "Completed safely"


def test_startup_recovery_interrupts_orphan_without_losing_partial_text(authenticated_client):
	ids = _seed_generation(authenticated_client)
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		message.content = "Persisted partial"
		message.status = "done"
		db.commit()

	assert ids["run_id"] in interrupt_orphaned_generation_runs()
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == "cancelled"
		assert message.content == "Persisted partial"
	assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.INTERRUPTED


@pytest.mark.parametrize(
	("winner", "loser", "winner_error", "expected_message_status"),
	[
		(GenerationRunStatus.COMPLETED, GenerationRunStatus.STOPPED, None, "done"),
		(GenerationRunStatus.STOPPED, GenerationRunStatus.COMPLETED, None, "cancelled"),
		(GenerationRunStatus.FAILED, GenerationRunStatus.COMPLETED, "AI_GENERATION_TIMEOUT", "error"),
		(GenerationRunStatus.INTERRUPTED, GenerationRunStatus.COMPLETED, None, "cancelled"),
	],
)
def test_competing_terminal_finalizations_have_one_winner(
	authenticated_client,
	winner,
	loser,
	winner_error,
	expected_message_status,
):
	ids = _seed_generation(authenticated_client, title=f"Terminal winner {winner.value}")
	start_generation_run(user_id=ids["user_id"], run_id=ids["run_id"])
	first, changed = finalize_generation_run(
		user_id=ids["user_id"],
		run_id=ids["run_id"],
		status=winner,
		assistant_content="Winner content",
		error_code=winner_error,
		request_id="winner-request",
	)
	assert changed is True
	assert first.status == winner
	with pytest.raises(InvalidGenerationRunTransition):
		finalize_generation_run(
			user_id=ids["user_id"],
			run_id=ids["run_id"],
			status=loser,
			assistant_content="Losing content",
			error_code="AI_GENERATION_TIMEOUT" if loser == GenerationRunStatus.FAILED else None,
			request_id="loser-request",
		)
	second, changed_again = finalize_generation_run(
		user_id=ids["user_id"],
		run_id=ids["run_id"],
		status=winner,
		assistant_content="Duplicate content",
		error_code=winner_error,
		request_id="duplicate-request",
	)
	assert changed_again is False
	assert second.status == winner
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == expected_message_status
		assert message.content == "Winner content"
		assert message.request_id == "winner-request"


def test_conflicting_active_generation_is_rejected_for_same_branch(authenticated_client):
	ids = _seed_generation(authenticated_client, title="Branch conflict")
	with SessionLocal() as db:
		second_assistant = Message(
			conversation_id=ids["conversation_id"],
			role="assistant",
			content="",
			status="streaming",
			reply_to_id=ids["user_message_id"],
			model_id="gpt-oss-120b",
		)
		db.add(second_assistant)
		db.commit()
		second_assistant_id = second_assistant.id

	with pytest.raises(GenerationRunConflict, match="active GenerationRun"):
		get_or_create_generation_run(
			user_id=ids["user_id"],
			conversation_id=ids["conversation_id"],
			branch_anchor_message_id=ids["user_message_id"],
			assistant_message_id=second_assistant_id,
			idempotency_key=f"direct:{second_assistant_id}",
			provider="groq",
			model="test-model",
		)
	with SessionLocal() as db:
		descendant_user = Message(
			conversation_id=ids["conversation_id"], role="user", content="Too early", status="done",
			reply_to_id=ids["assistant_message_id"], branch_group_id=None,
		)
		db.add(descendant_user)
		db.flush()
		descendant_user.branch_group_id = descendant_user.id
		descendant_assistant = Message(
			conversation_id=ids["conversation_id"], role="assistant", content="", status="streaming",
			reply_to_id=descendant_user.id,
		)
		db.add(descendant_assistant)
		db.commit()
		descendant_user_id = descendant_user.id
		descendant_assistant_id = descendant_assistant.id
	with pytest.raises(GenerationRunConflict, match="active GenerationRun"):
		get_or_create_generation_run(
			user_id=ids["user_id"],
			conversation_id=ids["conversation_id"],
			branch_anchor_message_id=descendant_user_id,
			assistant_message_id=descendant_assistant_id,
			idempotency_key=f"direct:{descendant_assistant_id}",
			provider="groq",
			model="test-model",
		)
	finalize_generation_run(
		user_id=ids["user_id"],
		run_id=ids["run_id"],
		status=GenerationRunStatus.STOPPED,
		assistant_content="Stopped partial",
	)
	retry_run, created = get_or_create_generation_run(
		user_id=ids["user_id"],
		conversation_id=ids["conversation_id"],
		branch_anchor_message_id=ids["user_message_id"],
		assistant_message_id=second_assistant_id,
		idempotency_key=f"direct:{second_assistant_id}",
		provider="groq",
		model="test-model",
	)
	assert created is True
	assert retry_run.status == GenerationRunStatus.QUEUED


def test_stream_endpoint_rejects_second_generation_on_active_branch_without_new_messages(authenticated_client):
	ids = _seed_generation(authenticated_client, title="Endpoint branch conflict")
	response = authenticated_client.post(
		f"/api/conversations/{ids['conversation_id']}/stream",
		data={"prompt": "Do not overlap"},
	)
	assert response.status_code == 409
	assert response.json()["error"]["code"] == "GENERATION_ALREADY_ACTIVE"
	with SessionLocal() as db:
		assert db.scalar(select(func.count(Message.id)).where(
			Message.conversation_id == ids["conversation_id"],
		)) == 2
		assert db.scalar(select(func.count(GenerationRun.id)).where(
			GenerationRun.conversation_id == ids["conversation_id"],
		)) == 1


def test_sibling_branch_can_start_while_original_branch_is_active(authenticated_client):
	ids = _seed_generation(authenticated_client, title="Sibling concurrency")
	with SessionLocal() as db:
		original = db.get(Message, ids["user_message_id"])
		sibling_user = Message(
			conversation_id=ids["conversation_id"],
			role="user",
			content="Sibling edit",
			status="done",
			branch_group_id=original.branch_group_id,
			reply_to_id=original.reply_to_id,
			model_id="gpt-oss-120b",
		)
		db.add(sibling_user)
		db.flush()
		sibling_assistant = Message(
			conversation_id=ids["conversation_id"],
			role="assistant",
			content="",
			status="streaming",
			reply_to_id=sibling_user.id,
			model_id="gpt-oss-120b",
		)
		db.add(sibling_assistant)
		db.commit()
		sibling_user_id = sibling_user.id
		sibling_assistant_id = sibling_assistant.id

	run, created = get_or_create_generation_run(
		user_id=ids["user_id"],
		conversation_id=ids["conversation_id"],
		branch_anchor_message_id=sibling_user_id,
		assistant_message_id=sibling_assistant_id,
		idempotency_key=f"direct:{sibling_assistant_id}",
		provider="gemini",
		model="test-gemini",
	)
	assert created is True
	assert run.status == GenerationRunStatus.QUEUED


def test_independent_chats_generate_in_parallel(authenticated_client, monkeypatch):
	import app.main as main_module

	first_ids = _seed_generation(authenticated_client, title="Parallel first")
	second_ids = _seed_generation(authenticated_client, title="Parallel second")
	entered: set[str] = set()
	both_entered = asyncio.Event()

	async def parallel_stream(_messages, _user_id, conversation_id, *_args, **_kwargs):
		entered.add(conversation_id)
		if len(entered) == 2:
			both_entered.set()
		await asyncio.wait_for(both_entered.wait(), timeout=1)
		yield f"answer:{conversation_id}"

	async def skip_memory(*_args, **_kwargs):
		return None

	monkeypatch.setattr(main_module, "_stream_ai_deltas", parallel_stream)
	monkeypatch.setattr(main_module, "_extract_and_store_memory", skip_memory)

	async def scenario():
		await asyncio.gather(
			main_module._execute_chat_generation(
				_spec(main_module, first_ids), lambda _event: None, lambda: GenerationRunStatus.INTERRUPTED,
			),
			main_module._execute_chat_generation(
				_spec(main_module, second_ids), lambda _event: None, lambda: GenerationRunStatus.INTERRUPTED,
			),
		)

	asyncio.run(scenario())
	assert entered == {first_ids["conversation_id"], second_ids["conversation_id"]}
	with SessionLocal() as db:
		runs = list(db.scalars(select(GenerationRun).where(GenerationRun.id.in_({
			first_ids["run_id"], second_ids["run_id"],
		}))))
		assert {run.status for run in runs} == {GenerationRunStatus.COMPLETED}


def test_graceful_shutdown_interrupts_managed_task(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client)
	provider_waiting = asyncio.Event()

	async def blocked_deltas(*_args, **_kwargs):
		yield "Shutdown partial"
		provider_waiting.set()
		await asyncio.Event().wait()

	monkeypatch.setattr(main_module, "_stream_ai_deltas", blocked_deltas)

	async def scenario():
		spec = _spec(main_module, ids)
		main_module.generation_task_manager.start(
			spec.run_id,
			lambda publish, cancel_status: main_module._execute_chat_generation(spec, publish, cancel_status),
		)
		await asyncio.wait_for(provider_waiting.wait(), timeout=1)
		await main_module.generation_task_manager.shutdown()

	asyncio.run(scenario())
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == "cancelled"
		assert message.content == "Shutdown partial"
	assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.INTERRUPTED


def test_stop_endpoint_is_user_scoped_and_stops_unattached_queued_run(authenticated_client, client):
	ids = _seed_generation(authenticated_client)
	response = authenticated_client.post(f"/api/messages/{ids['assistant_message_id']}/stop-generation")
	assert response.status_code == 200
	assert response.json()["generation"]["status"] == "stopped"

	client.post("/api/auth/logout")
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	identity = "other-generation-user"
	registered = client.post(
		"/api/auth/register",
		json={"login": identity, "email": f"{identity}@example.com", "password": "strong-password"},
	)
	client.headers.update({"X-CSRF-Token": registered.json()["csrfToken"]})
	assert client.post(f"/api/messages/{ids['assistant_message_id']}/stop-generation").status_code == 404
	assert client.get(
		f"/api/generation-runs/{ids['run_id']}",
		params={"conversation_id": ids["conversation_id"], "assistant_message_id": ids["assistant_message_id"]},
	).status_code == 404


def test_reconnect_snapshot_then_new_deltas_supports_multiple_subscribers(authenticated_client, monkeypatch):
	import app.main as main_module

	ids = _seed_generation(authenticated_client)
	first_delta_sent = asyncio.Event()
	release = asyncio.Event()
	provider_calls = 0

	async def controlled_deltas(*_args, **_kwargs):
		nonlocal provider_calls
		provider_calls += 1
		yield "Alpha"
		first_delta_sent.set()
		await release.wait()
		yield "Beta"

	monkeypatch.setattr(main_module, "_stream_ai_deltas", controlled_deltas)

	async def collect_until_closed(queue):
		events = []
		while True:
			value = await asyncio.wait_for(queue.get(), timeout=1)
			if value is None:
				return events
			events.append(json.loads(value))

	async def scenario():
		spec = _spec(main_module, ids)
		original = main_module.generation_task_manager.start(
			spec.run_id,
			lambda publish, cancel_status: main_module._execute_chat_generation(spec, publish, cancel_status),
			assistant_message_id=spec.assistant_message_id,
		)
		await asyncio.wait_for(first_delta_sent.wait(), timeout=1)
		first_queue, first_snapshot_raw = main_module.generation_task_manager.subscribe_with_snapshot(spec.run_id)
		second_queue, second_snapshot_raw = main_module.generation_task_manager.subscribe_with_snapshot(spec.run_id)
		first_snapshot = json.loads(first_snapshot_raw)
		second_snapshot = json.loads(second_snapshot_raw)
		assert first_snapshot == second_snapshot
		assert first_snapshot["content"] == "Alpha"
		assert first_snapshot["sequence"] == 1
		release.set()
		first_events, second_events = await asyncio.gather(
			collect_until_closed(first_queue),
			collect_until_closed(second_queue),
		)
		for events in (first_events, second_events):
			deltas = [event for event in events if event["type"] == "delta"]
			assert [(event["content"], event["sequence"]) for event in deltas] == [("Beta", 2)]
			assert events[-1]["type"] == "done"
		main_module.generation_task_manager.unsubscribe(spec.run_id, original)
		main_module.generation_task_manager.unsubscribe(spec.run_id, first_queue)
		main_module.generation_task_manager.unsubscribe(spec.run_id, second_queue)

	asyncio.run(scenario())
	assert provider_calls == 1


def test_queue_overflow_replaces_missing_events_with_fresh_snapshot(monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "GENERATION_EVENT_QUEUE_SIZE", 2)
	manager = main_module.GenerationTaskManager()

	async def worker(publish, _cancel_status):
		for part in ("A", "B", "C", "D", "E"):
			publish(main_module._event("delta", content=part))
		publish(main_module._event("done", messageId="assistant", message={"content": "ABCDE"}))

	async def scenario():
		queue = manager.start("overflow-run", worker, assistant_message_id="assistant")
		for _ in range(100):
			if not manager.has_task("overflow-run"):
				break
			await asyncio.sleep(0.01)
		events = []
		while True:
			value = queue.get_nowait()
			if value is None:
				break
			events.append(json.loads(value))
		assert events == [{
			"type": "snapshot",
			"generationRunId": "overflow-run",
			"assistantMessageId": "assistant",
			"sequence": 5,
			"status": "completed",
			"content": "ABCDE",
			"errorCode": None,
			"requestId": None,
		}]
		manager.unsubscribe("overflow-run", queue)

	asyncio.run(scenario())


def test_completed_generation_state_and_reconnect_return_persisted_result(authenticated_client):
	ids = _seed_generation(authenticated_client)
	start_generation_run(user_id=ids["user_id"], run_id=ids["run_id"])
	finish_generation_run(
		user_id=ids["user_id"],
		run_id=ids["run_id"],
		status=GenerationRunStatus.COMPLETED,
	)
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		message.content = "Persisted final"
		message.status = "done"
		db.commit()

	state = authenticated_client.get(f"/api/conversations/{ids['conversation_id']}/generation")
	assert state.status_code == 200
	generation = state.json()["generation"]
	assert generation["runId"] == ids["run_id"]
	assert generation["assistantMessageId"] == ids["assistant_message_id"]
	assert generation["status"] == "completed"
	assert generation["content"] == "Persisted final"
	reconnected = authenticated_client.get(
		f"/api/generation-runs/{ids['run_id']}/stream",
		params={"conversation_id": ids["conversation_id"], "assistant_message_id": ids["assistant_message_id"]},
	)
	assert reconnected.status_code == 200
	event = json.loads(reconnected.text)
	assert (event["type"], event["status"], event["content"]) == ("snapshot", "completed", "Persisted final")


def test_reconnect_rejects_generation_from_inactive_sibling_branch(authenticated_client):
	ids = _seed_generation(authenticated_client)
	with SessionLocal() as db:
		original_user = db.get(Message, ids["user_message_id"])
		original_user.is_active = False
		sibling_user = Message(
			conversation_id=ids["conversation_id"], role="user", content="Sibling", status="done",
			branch_group_id=original_user.branch_group_id, reply_to_id=original_user.reply_to_id, is_active=True,
		)
		db.add(sibling_user)
		db.flush()
		db.add(Message(
			conversation_id=ids["conversation_id"], role="assistant", content="Sibling answer", status="done",
			reply_to_id=sibling_user.id,
		))
		db.commit()

	response = authenticated_client.get(
		f"/api/generation-runs/{ids['run_id']}/stream",
		params={"conversation_id": ids["conversation_id"], "assistant_message_id": ids["assistant_message_id"]},
	)
	assert response.status_code == 409
	assert response.json()["error"]["code"] == "GENERATION_BRANCH_INACTIVE"
