import asyncio
import json
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import httpx
from google.genai import errors as genai_errors
from groq import RateLimitError
from sqlalchemy import select

import app.main as main_module
import app.observability as observability
from app.auth import hash_password
from app.database import SessionLocal
from app.models import AIUsageEvent, ActivityEvent, Conversation, Message, User
from app.observability import (
	configure_observability_logging,
	drain_observability_writes,
	estimate_ai_cost_usd,
	log_technical_event,
	record_ai_usage_event,
	technical_events_by_correlation_id,
)


def _identity() -> tuple[User, Conversation]:
	marker = uuid4().hex[:10]
	with SessionLocal() as db:
		user = User(
			login=f"observability-{marker}",
			email=f"observability-{marker}@example.com",
			password_hash=hash_password("strong-password"),
		)
		db.add(user)
		db.flush()
		conversation = Conversation(user_id=user.id, title="Observability test")
		db.add(conversation)
		db.commit()
		db.expunge(user)
		db.expunge(conversation)
		return user, conversation


def _completion(input_tokens: int = 100, output_tokens: int = 25, cached_tokens: int = 10):
	return SimpleNamespace(usage=SimpleNamespace(
		prompt_tokens=input_tokens,
		completion_tokens=output_tokens,
		prompt_tokens_details=SimpleNamespace(cached_tokens=cached_tokens),
	))


def test_ai_usage_persists_statuses_nulls_cost_and_deduplicates(client):
	user, conversation = _identity()
	event_id = str(uuid4())
	pricing = {
		"groq": {
			"test-model": {
				"input_per_million_usd": "1.00",
				"output_per_million_usd": "2.00",
				"cached_input_per_million_usd": "0.25",
			},
		},
	}
	assert record_ai_usage_event(
		event_id=event_id,
		user_id=user.id,
		conversation_id=conversation.id,
		correlation_id="usage-cost",
		purpose="chat",
		task_type="chat",
		provider="groq",
		model="test-model",
		prompt_version="chat:test",
		reasoning_effort=None,
		status="success",
		input_tokens=1_000_000,
		output_tokens=500_000,
		cached_tokens=200_000,
		latency_ms=12.5,
		pricing=pricing,
	)
	assert not record_ai_usage_event(
		event_id=event_id,
		user_id=user.id,
		conversation_id=conversation.id,
		correlation_id="usage-cost",
		purpose="chat",
		task_type="chat",
		provider="groq",
		model="test-model",
		prompt_version="chat:test",
		reasoning_effort=None,
		status="success",
		input_tokens=1,
		output_tokens=1,
		cached_tokens=0,
		latency_ms=1,
		pricing=pricing,
	)

	for status in ("error", "cancelled"):
		main_module._log_ai_usage(
			None,
			purpose="chat",
			task_type="chat",
			provider="groq",
			model="unknown-model",
			prompt_version="chat:test",
			reasoning_effort=None,
			status=status,
			latency_ms=3,
			event_id=str(uuid4()),
			user_id=user.id,
			conversation_id=conversation.id,
			correlation_id="usage-null",
		)

	with SessionLocal() as db:
		stored = db.get(AIUsageEvent, event_id)
		assert stored is not None
		assert stored.total_tokens == 1_500_000
		assert stored.estimated_cost_usd == Decimal("1.85000000")
		null_events = list(db.scalars(select(AIUsageEvent).where(AIUsageEvent.correlation_id == "usage-null")))
	assert {event.status for event in null_events} == {"error", "cancelled"}
	assert all(event.input_tokens is None and event.output_tokens is None for event in null_events)
	assert all(event.estimated_cost_usd is None for event in null_events)
	assert estimate_ai_cost_usd(
		provider="groq", model="unknown", input_tokens=10, output_tokens=10, cached_tokens=0, pricing=pricing,
	) is None


class _ChatStream:
	request_id = "provider-chat"

	def __init__(self):
		self._chunks = [
			SimpleNamespace(
				usage=None,
				choices=[SimpleNamespace(delta=SimpleNamespace(content="Ответ"))],
			),
			SimpleNamespace(
				usage=SimpleNamespace(prompt_tokens=120, completion_tokens=30),
				choices=[],
			),
		]

	def __aiter__(self):
		self._iterator = iter(self._chunks)
		return self

	async def __anext__(self):
		try:
			return next(self._iterator)
		except StopIteration as error:
			raise StopAsyncIteration from error


class _Completions:
	def __init__(self, result):
		self.result = result
		self.calls = 0

	async def create(self, **_kwargs):
		self.calls += 1
		return self.result() if callable(self.result) else self.result


class _FakeGroq:
	def __init__(self, completions):
		self.chat = SimpleNamespace(completions=completions)


def test_successful_title_usage_persists_once_after_request_transaction(client, monkeypatch):
	user, conversation = _identity()
	completion = SimpleNamespace(
		usage=SimpleNamespace(prompt_tokens=362, completion_tokens=22),
		choices=[SimpleNamespace(message=SimpleNamespace(content="Диагностический заголовок"))],
	)
	completions = _Completions(completion)
	monkeypatch.setattr(main_module, "client", _FakeGroq(completions))

	async def generate_title() -> str:
		with SessionLocal() as db:
			stored_conversation = db.get(Conversation, conversation.id)
			assert stored_conversation is not None
			db.add(Message(
				conversation_id=conversation.id,
				role="user",
				content="Создай заголовок",
			))
			db.flush()
			title = await main_module._generate_chat_title(
				"Создай заголовок",
				"Резервный заголовок",
				user_id=user.id,
				conversation_id=conversation.id,
				correlation_id="title-usage",
			)
			stored_conversation.title = title
			db.commit()
		await drain_observability_writes()
		return title

	assert asyncio.run(generate_title()) == "Диагностический заголовок"
	with SessionLocal() as db:
		events = list(db.scalars(select(AIUsageEvent).where(
			AIUsageEvent.correlation_id == "title-usage",
		)))
	assert len(events) == 1
	event = events[0]
	assert event.user_id == user.id
	assert event.conversation_id == conversation.id
	assert event.purpose == "title"
	assert event.task_type == "title"
	assert (event.provider, event.model) == ("groq", main_module.settings.groq_model)
	assert (event.input_tokens, event.output_tokens, event.total_tokens) == (362, 22, 384)
	assert event.status == "success"
	assert event.created_at is not None
	assert completions.calls == 1


def test_gemini_server_error_status_is_in_failure_diagnostics(authenticated_client, monkeypatch, caplog):
	error = genai_errors.ServerError(503, {
		"error": {"code": 503, "message": "Service unavailable", "status": "UNAVAILABLE"},
	})
	assert main_module._provider_status_code(error) == 503

	class FailingGeminiModels:
		async def generate_content_stream(self, **_kwargs):
			raise error

	monkeypatch.setattr(
		main_module,
		"gemini_client",
		SimpleNamespace(models=FailingGeminiModels()),
	)
	conversation_id = authenticated_client.post(
		"/api/conversations",
		json={"title": "Gemini failure diagnostics"},
	).json()["conversation"]["id"]
	caplog.set_level("ERROR")
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверка ошибки", "model_id": "gemini-3.8-flash"},
	)
	assert '"type": "error"' in response.text
	diagnostics = []
	for record in caplog.records:
		try:
			payload = json.loads(record.getMessage())
		except json.JSONDecodeError:
			continue
		if payload.get("event") == "AI_REQUEST_FAILED":
			diagnostics.append(payload)
	assert any(payload.get("providerStatus") == 503 for payload in diagnostics)
	assert any(payload.get("provider_status") == 503 for payload in diagnostics)


def test_chat_and_each_branch_summary_call_store_separate_actual_usage(client, monkeypatch):
	user, conversation = _identity()
	chat_completions = _Completions(_ChatStream)
	monkeypatch.setattr(main_module, "client", _FakeGroq(chat_completions))
	model = main_module.ChatModelSpec(
		id="test-chat", name="Test", description="Test", provider="groq", provider_model="test-model",
	)

	async def run_chat():
		parts = [part async for part in main_module._stream_groq_deltas(
			[{"role": "user", "content": "Не сохранять содержимое"}],
			user.id,
			conversation.id,
			False,
			model,
			task_type="chat",
			prompt_version="chat:test",
			correlation_id="chat-usage",
		)]
		await drain_observability_writes()
		return parts

	assert asyncio.run(run_chat()) == ["Ответ"]

	branch_completion = SimpleNamespace(
		usage=SimpleNamespace(prompt_tokens=80, completion_tokens=20),
		choices=[SimpleNamespace(
			finish_reason="stop",
			message=SimpleNamespace(content="Compact factual summary."),
		)],
	)
	branch_completions = _Completions(branch_completion)
	monkeypatch.setattr(main_module, "client", _FakeGroq(branch_completions))
	message = SimpleNamespace(id="summary-message", role="user", content="Unique fact")
	for _ in range(2):
		assert asyncio.run(main_module._generate_branch_summary(
			None,
			[message],
			user_id=user.id,
			conversation_id=conversation.id,
			correlation_id="summary-usage",
		))

	with SessionLocal() as db:
		chat_events = list(db.scalars(select(AIUsageEvent).where(AIUsageEvent.correlation_id == "chat-usage")))
		summary_events = list(db.scalars(select(AIUsageEvent).where(AIUsageEvent.correlation_id == "summary-usage")))
	assert len(chat_events) == 1
	assert (chat_events[0].input_tokens, chat_events[0].output_tokens) == (120, 30)
	assert len(summary_events) == 2
	assert branch_completions.calls == 2
	assert all(event.purpose == "branch_summary" for event in summary_events)


def test_branch_summary_retry_records_each_provider_call(client, monkeypatch):
	user, conversation = _identity()
	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	rate_limit = RateLimitError(
		"rate limited",
		response=httpx.Response(429, request=request, headers={"Retry-After": "0"}),
		body={"error": {"code": "rate_limit"}},
	)
	completion = SimpleNamespace(
		usage=SimpleNamespace(prompt_tokens=50, completion_tokens=15),
		choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content="Summary after retry."))],
	)

	class SequencedCompletions:
		def __init__(self):
			self.outcomes = [rate_limit, completion]

		async def create(self, **_kwargs):
			outcome = self.outcomes.pop(0)
			if isinstance(outcome, Exception):
				raise outcome
			return outcome

	monkeypatch.setattr(main_module, "client", _FakeGroq(SequencedCompletions()))
	result = asyncio.run(main_module._generate_branch_summary(
		None,
		[SimpleNamespace(id="retry-message", role="user", content="Important fact")],
		user_id=user.id,
		conversation_id=conversation.id,
		correlation_id="summary-retry-usage",
	))
	assert result

	with SessionLocal() as db:
		events = list(db.scalars(select(AIUsageEvent).where(
			AIUsageEvent.correlation_id == "summary-retry-usage",
		).order_by(AIUsageEvent.created_at, AIUsageEvent.id)))
	assert [event.status for event in events] == ["error", "success"]
	assert events[0].input_tokens is None
	assert (events[1].input_tokens, events[1].output_tokens) == (50, 15)


def test_activity_events_cover_auth_chat_and_knowledge(authenticated_client):
	current = authenticated_client.get("/api/auth/me").json()["user"]
	created = authenticated_client.post(
		"/api/conversations",
		json={"title": "Activity"},
		headers={"X-Request-ID": "activity-chat-create"},
	)
	conversation_id = created.json()["conversation"]["id"]
	assert authenticated_client.delete(
		f"/api/conversations/{conversation_id}",
		headers={"X-Request-ID": "activity-chat-delete"},
	).status_code == 204
	knowledge = authenticated_client.post(
		"/api/knowledge",
		json={"title": "Activity item", "content": "Test content"},
		headers={"X-Request-ID": "activity-knowledge-create"},
	)
	assert knowledge.status_code == 200
	knowledge_id = knowledge.json()["item"]["id"]
	assert authenticated_client.delete(
		f"/api/knowledge/{knowledge_id}",
		headers={"X-Request-ID": "activity-knowledge-delete"},
	).status_code == 204
	upload = authenticated_client.post(
		"/api/knowledge/files",
		files={"file": ("activity.txt", b"activity file", "text/plain")},
		data={"title": "Activity upload"},
		headers={"X-Request-ID": "activity-knowledge-upload"},
	)
	assert upload.status_code == 200
	uploaded_knowledge_id = upload.json()["item"]["id"]
	assert authenticated_client.post(
		"/api/auth/logout",
		headers={"X-Request-ID": "activity-logout"},
	).status_code == 200
	csrf = authenticated_client.get("/api/auth/csrf").json()["csrfToken"]
	authenticated_client.headers.update({"X-CSRF-Token": csrf})
	login = authenticated_client.post(
		"/api/auth/login",
		json={"identifier": current["login"], "password": "strong-password"},
		headers={"X-Request-ID": "activity-login"},
	)
	assert login.status_code == 200
	authenticated_client.headers.update({"X-CSRF-Token": login.json()["csrfToken"]})

	with SessionLocal() as db:
		events = list(db.scalars(select(ActivityEvent).where(ActivityEvent.user_id == current["id"])))
	by_type = {event.event_type: event for event in events}
	assert by_type["conversation.created"].correlation_id == "activity-chat-create"
	assert by_type["conversation.deleted"].correlation_id == "activity-chat-delete"
	assert by_type["knowledge.created"].resource_id == knowledge_id
	assert by_type["knowledge.deleted"].correlation_id == "activity-knowledge-delete"
	assert by_type["knowledge.file_uploaded"].resource_id == uploaded_knowledge_id
	assert by_type["knowledge.file_uploaded"].correlation_id == "activity-knowledge-upload"
	assert by_type["auth.registered"].resource_id == current["id"]
	assert by_type["auth.logout"].correlation_id == "activity-logout"
	assert by_type["auth.login"].correlation_id == "activity-login"


def test_observability_write_failure_does_not_break_main_action(authenticated_client, monkeypatch):
	class BrokenSession:
		def __enter__(self):
			return self

		def __exit__(self, *_args):
			return False

		def add(self, _value):
			raise RuntimeError("statistics unavailable")

		def rollback(self):
			pass

	monkeypatch.setattr(observability, "SessionLocal", lambda: BrokenSession())
	response = authenticated_client.post("/api/conversations", json={"title": "Still works"})
	assert response.status_code == 200

	monkeypatch.setattr(main_module, "record_ai_usage_event", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("down")))
	main_module._log_ai_usage(
		_completion(),
		purpose="chat",
		task_type="chat",
		provider="groq",
		model="test-model",
		prompt_version="chat:test",
		reasoning_effort=None,
		status="success",
		latency_ms=1,
	)


def test_jsonl_logging_rotates_and_excludes_sensitive_fields(tmp_path):
	path = tmp_path / "observability.jsonl"
	try:
		configure_observability_logging(path, max_bytes=320, backup_count=2)
		for index in range(20):
			log_technical_event(
				"error",
				"TEST_TECHNICAL_EVENT",
				correlation_id="rotation-correlation",
				provider="groq",
				model="test-model",
				status="error",
				error_code=f"E{index}",
				authorization="Bearer super-secret-token",
				cookie="session-secret",
				content="private user content",
				prompt="private prompt",
			)
		for handler in observability.structured_logger.handlers:
			handler.flush()
		files = [candidate for candidate in (path, tmp_path / "observability.jsonl.1", tmp_path / "observability.jsonl.2") if candidate.exists()]
		assert 2 <= len(files) <= 3
		combined = "\n".join(candidate.read_text(encoding="utf-8") for candidate in files)
		assert "super-secret-token" not in combined
		assert "session-secret" not in combined
		assert "private user content" not in combined
		assert "private prompt" not in combined
		for line in combined.splitlines():
			if not line.strip():
				continue
			payload = json.loads(line)
			assert {"timestamp", "level", "event"} <= set(payload)
		assert technical_events_by_correlation_id(
			"rotation-correlation", path=path, backup_count=2,
		)
	finally:
		configure_observability_logging()
