import asyncio
from types import SimpleNamespace

from sqlalchemy import func, select

from app.database import SessionLocal
from app.generation_runs import (
	get_generation_run,
	get_or_create_generation_run,
	interrupt_orphaned_generation_runs,
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


def test_startup_recovery_interrupts_orphan_without_losing_partial_text(authenticated_client):
	ids = _seed_generation(authenticated_client)
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		message.content = "Persisted partial"
		db.commit()

	assert ids["run_id"] in interrupt_orphaned_generation_runs()
	with SessionLocal() as db:
		message = db.get(Message, ids["assistant_message_id"])
		assert message is not None
		assert message.status == "cancelled"
		assert message.content == "Persisted partial"
	assert get_generation_run(user_id=ids["user_id"], run_id=ids["run_id"]).status == GenerationRunStatus.INTERRUPTED


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
