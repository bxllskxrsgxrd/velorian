import json
import re
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from groq import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError


class FakeCompletions:
	async def create(self, **kwargs):
		if not kwargs.get("stream", False):
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])
		async def chunks():
			for content in ("Привет", ", мир!"):
				yield SimpleNamespace(
					choices=[SimpleNamespace(delta=SimpleNamespace(content=content))],
				)
		return chunks()


class FakeGroq:
	def __init__(self, completions=None):
		self.chat = SimpleNamespace(completions=completions or FakeCompletions())


class FakeGeminiModels:
	def __init__(self):
		self.calls: list[dict] = []

	async def generate_content_stream(self, **kwargs):
		self.calls.append(kwargs)

		async def chunks():
			for content in ("Ответ", " Gemini"):
				yield SimpleNamespace(text=content, usage_metadata=None)

		return chunks()


class FakeGemini:
	def __init__(self):
		self.models = FakeGeminiModels()


class RecordingCompletions(FakeCompletions):
	def __init__(self):
		self.calls: list[dict] = []

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			self.calls.append(kwargs)
		return await super().create(**kwargs)


class ResponseStream:
	def __init__(self, stream, request_id: str):
		self.stream = stream
		request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
		self.response = httpx.Response(200, request=request, headers={"x-request-id": request_id})

	def __aiter__(self):
		return self.stream.__aiter__()


class BranchSummaryCompletions(FakeCompletions):
	def __init__(self):
		self.stream_calls: list[dict] = []
		self.summary_calls: list[dict] = []
		self.call_order: list[str] = []

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			self.call_order.append("chat")
			self.stream_calls.append(kwargs)
			return await super().create(**kwargs)
		if "response_format" in kwargs:
			return await super().create(**kwargs)
		self.call_order.append("summary")
		self.summary_calls.append(kwargs)
		return SimpleNamespace(
			choices=[SimpleNamespace(
				message=SimpleNamespace(content="SUMMARY_OLD_ACTIVE"),
				finish_reason="stop",
			)],
			usage=SimpleNamespace(prompt_tokens=20, completion_tokens=5),
		)


class SummaryResultCompletions(FakeCompletions):
	def __init__(self, content: str, finish_reason: str):
		self.content = content
		self.finish_reason = finish_reason
		self.calls: list[dict] = []
		self.stream_calls: list[dict] = []

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			self.stream_calls.append(kwargs)
			return await super().create(**kwargs)
		if "response_format" in kwargs:
			return await super().create(**kwargs)
		self.calls.append(kwargs)
		return SimpleNamespace(
			choices=[SimpleNamespace(
				message=SimpleNamespace(content=self.content),
				finish_reason=self.finish_reason,
			)],
			usage=SimpleNamespace(prompt_tokens=30, completion_tokens=10),
		)


class SequencedBranchSummaryCompletions(FakeCompletions):
	def __init__(self, outcomes: list[tuple[str, str] | Exception]):
		self.outcomes = list(outcomes)
		self.summary_calls: list[dict] = []
		self.stream_calls: list[dict] = []

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			self.stream_calls.append(kwargs)
			return await super().create(**kwargs)
		if "response_format" in kwargs:
			return await super().create(**kwargs)
		self.summary_calls.append(kwargs)
		outcome = self.outcomes.pop(0)
		if isinstance(outcome, Exception):
			raise outcome
		content, finish_reason = outcome
		return SimpleNamespace(
			choices=[SimpleNamespace(
				message=SimpleNamespace(content=content),
				finish_reason=finish_reason,
			)],
			usage=SimpleNamespace(prompt_tokens=40, completion_tokens=12),
		)


class ScopedBranchSummaryCompletions(FakeCompletions):
	def __init__(self):
		self.stream_calls: list[dict] = []
		self.summary_calls: list[dict] = []
		self.summary_counts = {"LEFT": 0, "RIGHT": 0}

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			self.stream_calls.append(kwargs)
			return await super().create(**kwargs)
		if "response_format" in kwargs:
			return await super().create(**kwargs)
		summary_input = kwargs["messages"][1]["content"]
		branch = "LEFT" if "LEFT_" in summary_input else "RIGHT"
		self.summary_counts[branch] += 1
		self.summary_calls.append({"branch": branch, "input": summary_input, "kwargs": kwargs})
		return SimpleNamespace(
			choices=[SimpleNamespace(message=SimpleNamespace(
				content=f"{branch}_SUMMARY_{self.summary_counts[branch]}",
			))],
			usage=SimpleNamespace(prompt_tokens=20, completion_tokens=5),
		)


class FixedCompletions:
	def __init__(self, content: str):
		self.content = content
		self.calls: list[dict] = []

	async def create(self, **kwargs):
		if not kwargs.get("stream", False):
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])
		self.calls.append(kwargs)
		async def chunks():
			yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=self.content))])
		return chunks()


class ContextRejectingCompletions(RecordingCompletions):
	async def create(self, **kwargs):
		if not kwargs.get("stream", False):
			return await FakeCompletions.create(self, **kwargs)
		self.calls.append(kwargs)
		if len(kwargs["messages"]) > 2:
			request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
			response = httpx.Response(413, request=request, headers={"x-request-id": "provider-full-413"})
			raise APIStatusError("context rejected", response=response, body={"error": {
				"message": "Maximum context length exceeded. Limit: 100000, Requested: 100500",
				"type": "invalid_request_error",
				"code": "context_length_exceeded",
			}})
		stream = await FakeCompletions.create(self, **kwargs)
		return ResponseStream(stream, "provider-compact-success")


class FailingStreamCompletions(FakeCompletions):
	def __init__(self, error_factory):
		self.error_factory = error_factory

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			raise self.error_factory()
		return await super().create(**kwargs)


def summary_provider_status_error(status_code: int, retry_after: str | None = None) -> APIStatusError:
	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	response = httpx.Response(
		status_code,
		request=request,
		headers={"Retry-After": retry_after} if retry_after is not None else None,
	)
	error_type = RateLimitError if status_code == 429 else APIStatusError
	return error_type(
		f"summary provider error {status_code}",
		response=response,
		body={"error": {"message": "summary request rejected", "code": "summary_error"}},
	)


def test_auth_session_and_structured_error(client):
	unauthorized = client.get("/api/conversations")
	assert unauthorized.status_code == 401
	assert unauthorized.json()["error"]["code"] == "AUTH_REQUIRED"

	registered = client.post(
		"/api/auth/register",
		json={"login": "first-user", "email": "first@example.com", "password": "strong-password"},
	)
	assert registered.status_code == 200
	assert registered.json()["user"]["email"] == "first@example.com"
	assert registered.json()["user"]["login"] == "first-user"
	client.headers.update({"X-CSRF-Token": registered.json()["csrfToken"]})
	assert client.get("/api/auth/me").status_code == 200

	client.post("/api/auth/logout")
	assert client.get("/api/auth/me").status_code == 401
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	login = client.post(
		"/api/auth/login",
		json={"identifier": "first@example.com", "password": "strong-password"},
	)
	assert login.status_code == 200
	client.headers.update({"X-CSRF-Token": login.json()["csrfToken"]})
	client.post("/api/auth/logout")
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	login_by_name = client.post("/api/auth/login", json={"identifier": "FIRST-USER", "password": "strong-password"})
	assert login_by_name.status_code == 200
	client.headers.update({"X-CSRF-Token": login_by_name.json()["csrfToken"]})

	duplicate_login = client.post("/api/auth/register", json={
		"login": "first-user", "email": "different@example.com", "password": "strong-password",
	})
	assert duplicate_login.status_code == 409
	assert duplicate_login.json()["error"]["code"] == "LOGIN_EXISTS"
	assert duplicate_login.json()["error"]["details"] == {"field": "login"}
	duplicate_email = client.post("/api/auth/register", json={
		"login": "different-user", "email": "first@example.com", "password": "strong-password",
	})
	assert duplicate_email.status_code == 409
	assert duplicate_email.json()["error"]["code"] == "EMAIL_EXISTS"
	assert duplicate_email.json()["error"]["details"] == {"field": "email"}

	validation = client.post("/api/auth/login", json={"identifier": "a", "password": "x"})
	assert validation.status_code == 422
	assert validation.json()["error"]["code"] == "VALIDATION_ERROR"
	assert validation.json()["error"]["details"]["fieldErrors"] == {
		"identifier": "Введите корректный email или логин",
		"password": "Пароль должен содержать от 8 до 128 символов",
	}
	invalid_login = client.post("/api/auth/register", json={
		"login": "name@example.com", "email": "valid@example.com", "password": "strong-password",
	})
	assert invalid_login.status_code == 422
	assert invalid_login.json()["error"]["details"]["fieldErrors"] == {
		"login": "Введите корректный логин без пробелов и символа @",
	}


def test_conversation_crud(authenticated_client):
	created = authenticated_client.post("/api/conversations", json={"title": "Тест"})
	assert created.status_code == 200
	conversation_id = created.json()["conversation"]["id"]

	loaded = authenticated_client.get(f"/api/conversations/{conversation_id}")
	assert loaded.status_code == 200
	assert loaded.json()["conversation"]["messages"] == []

	renamed = authenticated_client.patch(f"/api/conversations/{conversation_id}", json={"title": "Новое имя"})
	assert renamed.json()["conversation"]["title"] == "Новое имя"
	assert authenticated_client.delete(f"/api/conversations/{conversation_id}").status_code == 204


def test_unified_chat_and_knowledge_trash(authenticated_client):
	chat = authenticated_client.post("/api/conversations", json={"title": "В корзину"}).json()["conversation"]
	knowledge = authenticated_client.post(
		"/api/knowledge", json={"title": "Запись в корзину", "content": "Уникальный удалённый материал", "rating": 4},
	).json()["item"]

	assert authenticated_client.delete(f"/api/conversations/{chat['id']}").status_code == 204
	assert authenticated_client.delete(f"/api/knowledge/{knowledge['id']}").status_code == 204
	assert chat["id"] not in {item["id"] for item in authenticated_client.get("/api/conversations").json()["conversations"]}
	assert knowledge["id"] not in {item["id"] for item in authenticated_client.get("/api/knowledge").json()["items"]}
	assert authenticated_client.get(f"/api/conversations/{chat['id']}").status_code == 404
	assert authenticated_client.get(f"/api/knowledge/{knowledge['id']}").status_code == 404
	assert chat["id"] in {item["id"] for item in authenticated_client.get("/api/conversations/trash").json()["conversations"]}
	deleted_knowledge = authenticated_client.get("/api/knowledge/trash").json()["items"]
	assert knowledge["id"] in {item["id"] for item in deleted_knowledge}
	assert next(item for item in deleted_knowledge if item["id"] == knowledge["id"])["rating"] == 4
	from app.database import SessionLocal
	from app.knowledge_retrieval import KnowledgeSearchOptions, knowledge_retrieval_service
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		retrieval = knowledge_retrieval_service.search(
			db, user_id, KnowledgeSearchOptions(query="Уникальный удалённый материал"),
		)
	assert knowledge["id"] not in {item.id for item in retrieval.items}

	restored_chat = authenticated_client.post(f"/api/conversations/trash/{chat['id']}/restore")
	restored_knowledge = authenticated_client.post(f"/api/knowledge/trash/{knowledge['id']}/restore")
	assert restored_chat.status_code == restored_knowledge.status_code == 200
	assert restored_chat.json()["conversation"]["deletedAt"] is None
	assert restored_knowledge.json()["item"]["deletedAt"] is None
	assert restored_knowledge.json()["item"]["rating"] == 4

	assert authenticated_client.delete(f"/api/conversations/{chat['id']}").status_code == 204
	assert authenticated_client.delete(f"/api/knowledge/{knowledge['id']}").status_code == 204
	assert authenticated_client.delete(f"/api/conversations/trash/{chat['id']}").status_code == 204
	assert authenticated_client.delete(f"/api/knowledge/trash/{knowledge['id']}").status_code == 204
	assert authenticated_client.get("/api/conversations/trash").json()["conversations"] == []
	assert authenticated_client.get("/api/knowledge/trash").json()["items"] == []

	second_chat_id = authenticated_client.post("/api/conversations", json={"title": "Очистить"}).json()["conversation"]["id"]
	second_knowledge_id = authenticated_client.post(
		"/api/knowledge", json={"title": "Очистить", "content": "Очистить корзину"},
	).json()["item"]["id"]
	authenticated_client.delete(f"/api/conversations/{second_chat_id}")
	authenticated_client.delete(f"/api/knowledge/{second_knowledge_id}")
	assert authenticated_client.delete("/api/conversations/trash").status_code == 204
	assert authenticated_client.delete("/api/knowledge/trash").status_code == 204
	assert authenticated_client.get("/api/conversations/trash").json()["conversations"] == []
	assert authenticated_client.get("/api/knowledge/trash").json()["items"] == []


def test_trash_cleanup_uses_exact_thirty_day_timestamp(authenticated_client):
	import asyncio
	from datetime import timedelta

	import app.main as main_module
	from app.database import SessionLocal
	from app.knowledge import purge_expired_knowledge_items
	from app.models import Conversation, KnowledgeItem, utc_now

	chat_id = authenticated_client.post("/api/conversations", json={"title": "Точный срок"}).json()["conversation"]["id"]
	knowledge_id = authenticated_client.post(
		"/api/knowledge", json={"title": "Точный срок", "content": "Не раньше тридцати суток"},
	).json()["item"]["id"]
	reference_now = utc_now()
	with SessionLocal() as db:
		chat = db.get(Conversation, chat_id)
		knowledge = db.get(KnowledgeItem, knowledge_id)
		chat.deleted_at = reference_now - timedelta(days=30) + timedelta(seconds=1)
		knowledge.deleted_at = reference_now - timedelta(days=30) + timedelta(seconds=1)
		db.commit()
		asyncio.run(main_module.purge_expired_conversations(db, reference_now))
		asyncio.run(purge_expired_knowledge_items(db, reference_now))
		assert db.get(Conversation, chat_id) is not None
		assert db.get(KnowledgeItem, knowledge_id) is not None

		chat.deleted_at = reference_now - timedelta(days=30)
		knowledge.deleted_at = reference_now - timedelta(days=30)
		db.commit()
		asyncio.run(main_module.purge_expired_conversations(db, reference_now))
		asyncio.run(purge_expired_knowledge_items(db, reference_now))
		assert db.get(Conversation, chat_id) is None
		assert db.get(KnowledgeItem, knowledge_id) is None


def test_permanent_chat_delete_preserves_saved_knowledge_file(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq())
	chat_id = authenticated_client.post("/api/conversations", json={"title": "Источник Knowledge"}).json()["conversation"]["id"]
	authenticated_client.post(
		f"/api/conversations/{chat_id}/stream",
		data={"prompt": "Сохрани файл"},
		files={"files": ("source.txt", b"independent knowledge file", "text/plain")},
	)
	conversation = authenticated_client.get(f"/api/conversations/{chat_id}").json()["conversation"]
	attachment = next(message["attachments"][0] for message in conversation["messages"] if message["attachments"])
	knowledge = authenticated_client.post(
		f"/api/knowledge/attachments/{attachment['id']}", json={"filters": {}},
	).json()["item"]

	assert authenticated_client.delete(f"/api/conversations/{chat_id}").status_code == 204
	assert authenticated_client.delete(f"/api/conversations/trash/{chat_id}").status_code == 204
	preserved = authenticated_client.get(f"/api/knowledge/{knowledge['id']}")
	assert preserved.status_code == 200
	assert preserved.json()["item"]["sourceMessageId"] is None
	assert preserved.json()["item"]["sourceFileId"] is None
	assert authenticated_client.get(f"/api/knowledge/{knowledge['id']}/file?original=true").content == b"independent knowledge file"


def test_public_config_exposes_canonical_attachment_limits(client):
	from app.config import settings

	response = client.get("/api/config")
	assert response.status_code == 200
	assert response.json()["attachmentLimits"] == {
		"maxAttachments": settings.max_files,
		"maxFileSize": settings.max_file_size,
		"maxTotalSize": settings.max_total_file_size,
	}
	models = {model["id"]: model for model in response.json()["aiModels"]}
	assert set(models) == {"gpt-oss-120b", "qwen-3.8", "gemini-3.8-flash"}
	assert models["gpt-oss-120b"]["available"] is True
	assert models["qwen-3.8"]["available"] is True
	assert response.json()["defaultAiModelId"] == "gpt-oss-120b"


def test_stream_uses_selected_qwen_model(authenticated_client, monkeypatch):
	import app.main as main_module
	from app.config import settings

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Qwen"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Ответь через Qwen", "model_id": "qwen-3.8"},
	)

	assert '"type": "done"' in response.text
	assert completions.calls[-1]["model"] == settings.groq_qwen_model
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	assert [message["modelId"] for message in messages] == ["qwen-3.8", "qwen-3.8"]


def test_stream_uses_selected_gemini_model(authenticated_client, monkeypatch):
	import app.main as main_module
	from app.config import settings

	gemini = FakeGemini()
	monkeypatch.setattr(main_module, "gemini_client", gemini)
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Gemini"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Ответь через Gemini", "model_id": "gemini-3.8-flash"},
	)

	assert '"type": "done"' in response.text
	assert gemini.models.calls[-1]["model"] == settings.gemini_model
	assert "Ответ Gemini" in response.text
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	assert [message["modelId"] for message in messages] == ["gemini-3.8-flash", "gemini-3.8-flash"]


def test_stream_rejects_unknown_model(authenticated_client):
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Unknown model"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверка", "model_id": "provider/arbitrary-model"},
	)

	assert response.status_code == 422
	assert response.json()["error"]["code"] == "AI_MODEL_INVALID"


def test_streaming_and_retry(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]

	with authenticated_client.stream(
		"POST",
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Поздоровайся", "web_search": "false"},
	) as response:
		lines = [line for line in response.iter_lines() if line]

	assert response.status_code == 200
	assert '"type": "meta"' in lines[0]
	assert any('"type": "delta"' in line for line in lines)
	assert '"type": "done"' in lines[-1]

	loaded = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	assert [message["role"] for message in loaded["messages"]] == ["user", "assistant"]
	assert loaded["messages"][-1]["content"] == "Привет, мир!"


def test_normalizes_broken_history():
	from app.main import _normalize_chat_history

	normalized = _normalize_chat_history([
		{"role": "assistant", "content": "orphan"},
		{"role": "user", "content": "Первый вопрос"},
		{"role": "assistant", "content": "Ответ"},
		{"role": "user", "content": "Повтори"},
		{"role": "user", "content": "Повтори"},
		{"role": "user", "content": "И уточни детали"},
	])

	assert [message["role"] for message in normalized] == ["user", "assistant", "user"]
	assert normalized[-1]["content"].count("Повтори") == 1
	assert "И уточни детали" in normalized[-1]["content"]


def test_retries_rejected_history_with_compact_context(authenticated_client, monkeypatch, caplog):
	import app.main as main_module
	from app import groq_diagnostics

	completions = ContextRejectingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(
		groq_diagnostics,
		"settings",
		replace(groq_diagnostics.settings, app_env="development", groq_debug_errors=True),
	)
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Контекст"}).json()["conversation"]["id"]

	first = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Первый вопрос"},
	)
	assert '"type": "done"' in first.text

	with caplog.at_level("WARNING", logger="velorian"):
		second = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream",
			data={"prompt": "Продолжи"},
		)

	assert '"type": "done"' in second.text
	assert len(completions.calls) == 3
	assert [message["role"] for message in completions.calls[1]["messages"]] == ["system", "user", "assistant", "user"]
	assert [message["role"] for message in completions.calls[2]["messages"]] == ["system", "user"]
	meta = next(json.loads(line) for line in second.text.splitlines() if '"type": "meta"' in line)
	diagnostics = [
		json.loads(record.getMessage())
		for record in caplog.records
		if record.name == "velorian" and record.getMessage().startswith("{")
	]
	provider_error = next(item for item in diagnostics if item.get("event") == "GROQ_API_ERROR")
	fallback_started = next(item for item in diagnostics if item.get("event") == "GROQ_COMPACT_FALLBACK_STARTED")
	fallback_result = next(item for item in diagnostics if item.get("event") == "GROQ_COMPACT_FALLBACK_RESULT")
	assert provider_error["http_status"] == 413
	assert provider_error["constraint_type"] == "context"
	assert provider_error["provider_request_id"] == "provider-full-413"
	assert provider_error["correlation_id"] == meta["requestId"]
	assert fallback_started["correlation_id"] == meta["requestId"]
	assert fallback_started["reason"] == "retryable_provider_status_without_partial_output"
	assert fallback_started["full_input_tokens_estimate"] > fallback_started["compact_input_tokens_estimate"]
	assert fallback_result["correlation_id"] == meta["requestId"]
	assert fallback_result["result"] == "success"
	assert fallback_result["provider_request_id"] == "provider-compact-success"
	assert "Первый вопрос" not in "\n".join(record.getMessage() for record in caplog.records)
	assert "Продолжи" not in "\n".join(record.getMessage() for record in caplog.records)


def test_provider_rate_limit_and_connection_errors_remain_safe_for_frontend(authenticated_client, monkeypatch):
	import app.main as main_module

	def rate_limit_error():
		request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
		response = httpx.Response(429, request=request, headers={"x-request-id": "provider-rate-limit"})
		return RateLimitError(
			"raw rate limit SDK message",
			response=response,
			body={"error": {"message": "raw private provider reason", "type": "rate_limit", "code": "tpm"}},
		)

	def connection_error():
		request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
		return APIConnectionError(message="raw private connection reason", request=request)

	for index, (error_factory, expected_code) in enumerate((
		(rate_limit_error, "AI_RATE_LIMITED"),
		(connection_error, "AI_UNAVAILABLE"),
	)):
		monkeypatch.setattr(main_module, "client", FakeGroq(FailingStreamCompletions(error_factory)))
		conversation_id = authenticated_client.post(
			"/api/conversations",
			json={"title": f"Provider failure {index}"},
		).json()["conversation"]["id"]
		response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream",
			data={"prompt": "Проверь безопасную ошибку"},
		)
		error_event = next(json.loads(line) for line in response.text.splitlines() if '"type": "error"' in line)
		assert error_event["code"] == expected_code
		assert "raw private" not in response.text
		assert "raw rate limit SDK message" not in response.text


def test_retry_creates_a_new_user_message(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Повтор"}).json()["conversation"]["id"]
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Исходный вопрос"},
		files={"files": ("notes.txt", b"context", "text/plain")},
	)
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	user_message_id = conversation["messages"][0]["id"]

	retried = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"retry_message_id": user_message_id},
	)

	assert '"type": "done"' in retried.text
	updated_messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	assert [message["role"] for message in updated_messages] == ["user", "assistant", "user", "assistant"]
	assert updated_messages[0]["id"] != updated_messages[2]["id"]
	assert updated_messages[0]["content"] == updated_messages[2]["content"] == "Исходный вопрос"
	assert updated_messages[0]["attachments"][0]["name"] == updated_messages[2]["attachments"][0]["name"] == "notes.txt"
	assert updated_messages[0]["attachments"][0]["id"] != updated_messages[2]["attachments"][0]["id"]
	assert [[message["role"] for message in call["messages"]] for call in completions.calls] == [
		["system", "user"],
		["system", "user", "assistant", "user"],
	]


def test_edit_creates_branch_and_can_switch_versions(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Ветки"}).json()["conversation"]["id"]
	for prompt in ("A", "B1"):
		authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	original = next(message for message in messages if message["content"] == "B1")
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "C"},
		files={"files": ("old-branch.txt", b"OLD BRANCH ATTACHMENT", "text/plain")},
	)
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "D"})

	edited = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "B2", "edit_message_id": original["id"]},
	)
	assert '"type": "done"' in edited.text
	assert [message["content"] for message in completions.calls[-1]["messages"] if message["role"] == "user"] == ["A", "B2"]
	assert "OLD BRANCH ATTACHMENT" not in completions.calls[-1]["messages"][-1]["content"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "E"})
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "F"})
	assert [message["content"] for message in completions.calls[-1]["messages"] if message["role"] == "user"] == ["A", "B2", "E", "F"]

	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	user_versions = [message for message in messages if message["content"] in {"B1", "B2"}]
	assert user_versions[0]["branchGroupId"] == user_versions[1]["branchGroupId"]
	assert [message["isActive"] for message in user_versions] == [False, True]
	assert user_versions[0]["replyToId"] == user_versions[1]["replyToId"]
	assert {message["content"] for message in messages if message["role"] == "user"} == {"A", "B1", "C", "D", "B2", "E", "F"}

	activated = authenticated_client.patch(f"/api/messages/{original['id']}/activate")
	assert activated.status_code == 200
	user_versions = [message for message in authenticated_client.get(
		f"/api/conversations/{conversation_id}"
	).json()["conversation"]["messages"] if message["content"] in {"B1", "B2"}]
	assert [message["isActive"] for message in user_versions] == [True, False]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "G"})
	assert [
		message["content"].split("\n\n<document_context>", 1)[0]
		for message in completions.calls[-1]["messages"] if message["role"] == "user"
	] == [
		"A", "B1", "C", "D", "G",
	]


def test_chat_context_builder_isolates_sibling_branches(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Изоляция веток"}).json()["conversation"]["id"]
	for prompt in ("A", "B", "C1", "D1"):
		authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})

	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	c1 = next(message for message in messages if message["content"] == "C1")
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "C2", "edit_message_id": c1["id"]},
	)
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "D2"})

	user_path = [
		message["content"]
		for message in completions.calls[-1]["messages"]
		if message["role"] == "user"
	]
	assert user_path == ["A", "B", "C2", "D2"]
	assert not {"C1", "D1"}.intersection(user_path)


def test_chat_context_builder_limits_active_branch_history_by_token_budget(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	completions = BranchSummaryCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module, "settings", replace(main_module.settings, history_token_budget=15))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "History budget"}).json()["conversation"]["id"]

	with caplog.at_level("INFO", logger="uvicorn.error"):
		for prompt in ("A" * 20, "B" * 8, "C" * 4, "D" * 2):
			authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})

	selected_messages = [
		message for message in completions.stream_calls[-1]["messages"][1:]
		if message["role"] != "system"
	]
	assert [(message["role"], message["content"]) for message in selected_messages] == [
		("user", "C" * 4),
		("assistant", "Привет, мир!"),
		("user", "D" * 2),
	]

	context_logs = [record.getMessage() for record in caplog.records if record.getMessage().startswith("AI context size ")]
	history_tokens = int(next(part for part in context_logs[-1].split() if part.startswith("history_tokens=")).split("=", 1)[1])
	assert history_tokens <= 15


def test_branch_summary_contains_only_evicted_active_history(authenticated_client, monkeypatch, caplog):
	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	completions = BranchSummaryCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Branch summary budget"},
	).json()["conversation"]["id"]
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "OLD_ACTIVE_MESSAGE_" * 3},
	)
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "SIBLING_B1"})
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "SIBLING_C1"})
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	sibling_b1 = next(message for message in messages if message["content"] == "SIBLING_B1")
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "ACTIVE_FRESH", "edit_message_id": sibling_b1["id"]},
	)
	monkeypatch.setattr(main_module, "settings", replace(
		main_module.settings,
		app_env="development",
		history_token_budget=15,
		summary_debug_metrics=True,
	))

	with caplog.at_level("INFO"):
		first_response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream", data={"prompt": "CURRENT"},
		)
	first_meta = next(json.loads(line) for line in first_response.text.splitlines() if '"type": "meta"' in line)

	assert len(completions.summary_calls) == 1
	assert completions.call_order[-2:] == ["summary", "chat"]
	summary_input = completions.summary_calls[0]["messages"][1]["content"]
	assert "OLD_ACTIVE_MESSAGE_" in summary_input
	assert "SIBLING_B1" not in summary_input
	assert "SIBLING_C1" not in summary_input
	assert "ACTIVE_FRESH" not in summary_input
	assert "CURRENT" not in summary_input
	main_context = completions.stream_calls[-1]["messages"]
	assert [message["content"] for message in main_context if message["role"] == "user"] == [
		"ACTIVE_FRESH", "CURRENT",
	]
	assert {
		"role": "system",
		"content": main_module.BRANCH_SUMMARY_CONTEXT_PREFIX + "SUMMARY_OLD_ACTIVE",
	} in main_context
	final_context_log = next(
		record.getMessage() for record in reversed(caplog.records)
		if record.getMessage().startswith("AI final context ")
	)
	assert "summary_present=true" in final_context_log
	final_summary_tokens = int(
		next(part for part in final_context_log.split() if part.startswith("summary_tokens=")).split("=", 1)[1]
	)
	assert final_summary_tokens == main_module.estimate_tokens(
		main_module.BRANCH_SUMMARY_CONTEXT_PREFIX + "SUMMARY_OLD_ACTIVE"
	)

	with SessionLocal() as db:
		summary = db.scalar(select(BranchSummary).where(BranchSummary.conversation_id == conversation_id))
		assert summary is not None
		assert summary.summary_text == "SUMMARY_OLD_ACTIVE"
		assert db.get(Message, summary.branch_anchor_message_id).content == "CURRENT"
		assert db.get(Message, summary.summarized_through_message_id).reply_to_id is not None

	usage_logs = [record.getMessage() for record in caplog.records if "purpose=branch_summary" in record.getMessage()]
	assert len(usage_logs) == 1
	assert "task_type=summary" in usage_logs[0]
	assert "prompt_version=branch_summary:v4" in usage_logs[0]

	with caplog.at_level("INFO"):
		second_response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream", data={"prompt": "NEXT"},
		)
	second_meta = next(json.loads(line) for line in second_response.text.splitlines() if '"type": "meta"' in line)

	assert len(completions.summary_calls) == 2
	incremental_input = completions.summary_calls[1]["messages"][1]["content"]
	assert "SUMMARY_OLD_ACTIVE" in incremental_input
	assert "ACTIVE_FRESH" in incremental_input
	assert "OLD_ACTIVE_MESSAGE_" not in incremental_input
	assert "SIBLING_B1" not in incremental_input
	assert "SIBLING_C1" not in incremental_input
	assert "CURRENT" not in incremental_input
	assert "NEXT" not in incremental_input
	assert [message["content"] for message in completions.stream_calls[-1]["messages"] if message["role"] == "user"] == [
		"CURRENT", "NEXT",
	]
	with SessionLocal() as db:
		summaries = list(db.scalars(
			select(BranchSummary).where(BranchSummary.conversation_id == conversation_id)
		))
		assert len(summaries) == 2

	metric_logs = [
		json.loads(record.getMessage())
		for record in caplog.records
		if record.name == "uvicorn.error" and '"event": "BRANCH_SUMMARY_METRICS"' in record.getMessage()
	]
	generation_logs = [metric for metric in metric_logs if metric["phase"] == "generation"]
	persistence_logs = [metric for metric in metric_logs if metric["phase"] == "persistence"]
	assert len(generation_logs) == 2
	assert len(persistence_logs) == 2
	summary_tokens = main_module.estimate_tokens("SUMMARY_OLD_ACTIVE")
	for index, (metric, correlation_id, call) in enumerate(zip(
		generation_logs,
		(first_meta["requestId"], second_meta["requestId"]),
		completions.summary_calls,
		strict=True,
	)):
		input_content = call["messages"][1]["content"]
		excluded_contents = re.findall(
			r'<message role="[^"]+" id="[^"]+">\n(.*?)\n</message>',
			input_content,
			flags=re.DOTALL,
		)
		assert metric["event"] == "BRANCH_SUMMARY_METRICS"
		assert metric["result"] == "accepted"
		assert not metric["summary_persisted"]
		assert metric["correlation_id"] == correlation_id
		assert metric["previous_summary_tokens"] == (0 if index == 0 else summary_tokens)
		assert metric["new_summary_tokens"] == summary_tokens
		assert metric["summary_size_delta_tokens"] == (summary_tokens if index == 0 else 0)
		assert metric["excluded_message_count"] == len(excluded_contents)
		assert metric["excluded_message_tokens"] == sum(
			main_module.estimate_tokens(content) for content in excluded_contents
		)
		assert metric["summary_input_tokens"] == 20
		assert metric["summary_output_tokens"] == 5
		assert metric["finish_reason"] == "stop"
		assert metric["trigger_reason"] == "new_excluded_history"
		assert metric["status"] == "success"
		assert (
			metric["estimated_request_input_tokens"]
			+ metric["max_completion_tokens"]
			+ metric["request_token_margin"]
			<= metric["request_token_budget"]
		)
	assert all(metric["result"] == "persisted" and metric["summary_persisted"] for metric in persistence_logs)
	assert {metric["summarized_through_message_id"] for metric in persistence_logs} == {
		summary.summarized_through_message_id for summary in summaries
	}


def test_branch_summary_metrics_follow_server_flags_and_log_completion_details(monkeypatch, caplog):
	import app.main as main_module

	completion = SimpleNamespace(
		choices=[SimpleNamespace(
			message=SimpleNamespace(content="summary"),
			finish_reason="stop",
		)],
		usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2),
	)
	existing_summary = SimpleNamespace(summary_text="previous summary")
	message = SimpleNamespace(id="message-1", role="user", content="excluded batch")
	base_settings = main_module.settings
	monkeypatch.setattr(main_module, "settings", replace(
		base_settings,
		app_env="production",
		summary_debug_metrics=True,
	))
	with caplog.at_level("INFO", logger="uvicorn.error"):
		main_module._log_branch_summary_metrics(
			completion,
			existing_summary=existing_summary,
			new_messages=[message],
			correlation_id="correlation-1",
			trigger_reason="new_excluded_history",
			status="success",
			result="accepted",
		)

	assert not any("BRANCH_SUMMARY_METRICS" in record.getMessage() for record in caplog.records)
	caplog.clear()
	monkeypatch.setattr(main_module, "settings", replace(
		base_settings,
		app_env="development",
		summary_debug_metrics=True,
	))
	with caplog.at_level("INFO", logger="uvicorn.error"):
		main_module._log_branch_summary_metrics(
			completion,
			existing_summary=existing_summary,
			new_messages=[message],
			correlation_id="correlation-1",
			trigger_reason="new_excluded_history",
			status="success",
			result="accepted",
		)
	metric = json.loads(next(record.getMessage() for record in caplog.records if "BRANCH_SUMMARY_METRICS" in record.getMessage()))
	previous_tokens = main_module.estimate_tokens(existing_summary.summary_text)
	new_tokens = main_module.estimate_tokens("summary")
	assert metric == {
		"event": "BRANCH_SUMMARY_METRICS",
		"phase": "generation",
		"result": "accepted",
		"summary_persisted": False,
		"correlation_id": "correlation-1",
		"previous_summary_tokens": previous_tokens,
		"new_summary_tokens": new_tokens,
		"summary_size_delta_tokens": new_tokens - previous_tokens,
		"previous_summary_chars": len(existing_summary.summary_text),
		"new_summary_chars": len("summary"),
		"summary_growth_percent": -56.25,
		"summary_compression_ratio": 0.2333,
		"summary_growth_warning": False,
		"excluded_message_count": 1,
		"excluded_message_tokens": main_module.estimate_tokens(message.content),
		"summary_input_tokens": 10,
		"summary_output_tokens": 2,
		"finish_reason": "stop",
		"summarized_through_message_id": "message-1",
		"estimated_request_input_tokens": main_module._branch_summary_request_input_tokens(
			existing_summary, [message],
		),
		"request_token_budget": main_module.settings.branch_summary_request_token_budget,
		"request_token_margin": main_module.BRANCH_SUMMARY_REQUEST_TOKEN_MARGIN,
		"max_completion_tokens": main_module.settings.branch_summary_max_output_tokens,
		"trigger_reason": "new_excluded_history",
		"status": "success",
	}
	caplog.clear()
	with caplog.at_level("INFO", logger="uvicorn.error"):
		main_module._log_branch_summary_metrics(
			None,
			existing_summary=None,
			new_messages=[message],
			correlation_id="correlation-2",
			trigger_reason="new_excluded_history",
			status="error",
			result="provider_error",
		)
	failed_metric = json.loads(next(
		record.getMessage() for record in caplog.records if "BRANCH_SUMMARY_METRICS" in record.getMessage()
	))
	assert failed_metric["status"] == "error"
	assert failed_metric["correlation_id"] == "correlation-2"
	assert failed_metric["new_summary_tokens"] is None
	assert failed_metric["summary_input_tokens"] is None
	assert failed_metric["summary_output_tokens"] is None
	assert failed_metric["finish_reason"] is None
	assert failed_metric["previous_summary_chars"] == 0
	assert failed_metric["new_summary_chars"] is None
	assert failed_metric["summary_growth_percent"] is None
	assert failed_metric["summary_compression_ratio"] is None
	assert not failed_metric["summary_growth_warning"]


def test_branch_summary_uses_dedicated_output_budget_and_compact_prompt(monkeypatch):
	import asyncio

	import app.main as main_module

	completions = SummaryResultCompletions("COMPLETE_SUMMARY", "stop")
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module, "settings", replace(
		main_module.settings,
		max_output_tokens=8192,
		branch_summary_max_output_tokens=1024,
	))
	message = SimpleNamespace(id="message-1", role="user", content="Important exact fact ID-42")

	result = asyncio.run(main_module._generate_branch_summary(None, [message]))

	assert result == "COMPLETE_SUMMARY"
	assert main_module.settings.max_output_tokens == 8192
	assert completions.calls[0]["max_completion_tokens"] == 1024
	prompt = completions.calls[0]["messages"][0]["content"]
	assert main_module.BRANCH_SUMMARY_PROMPT_VERSION == "branch_summary:v4"
	assert "Rewrite one complete, current working summary" in prompt
	assert "Replace the old summary; do not append" in prompt
	assert "Target 500-700 output tokens" in prompt
	assert "Merge repeated facts and semantically equivalent statements" in prompt
	assert "Preserve chronology, important facts, decisions, constraints, identifiers" in prompt
	assert "When a decision changes" in prompt
	assert "Do not add facts" in prompt
	assert "never drop unique important information" in prompt
	assert "[No existing summary]" not in completions.calls[0]["messages"][1]["content"]


def test_branch_summary_v4_passes_inputs_once_and_preserves_mocked_facts(monkeypatch):
	import asyncio

	import app.main as main_module

	existing_text = "CURRENT_DECISION_ID_42 uses config.yml with timeout=30."
	first_message_text = "Change timeout from 30 to 45 for /api/reports."
	second_message_text = "Constraint: never expose PII; keep CURRENT_DECISION_ID_42."
	rewritten = (
		"CURRENT_DECISION_ID_42 uses config.yml with timeout=45 for /api/reports. "
		"The previous value was 30. Constraint: never expose PII."
	)
	completions = SummaryResultCompletions(rewritten, "stop")
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	existing = SimpleNamespace(summary_text=existing_text)
	messages = [
		SimpleNamespace(id="message-1", role="user", content=first_message_text),
		SimpleNamespace(id="message-2", role="assistant", content=second_message_text),
	]

	result = asyncio.run(main_module._generate_branch_summary(existing, messages))

	assert result == rewritten
	assert len(completions.calls) == 1
	payload = completions.calls[0]["messages"][1]["content"]
	assert payload.count(existing_text) == 1
	assert payload.count(first_message_text) == 1
	assert payload.count(second_message_text) == 1
	assert payload.count("<existing_summary>") == 1
	assert payload.count("<new_messages>") == 1
	assert payload.count('<message role="user" id="message-1">') == 1
	assert payload.count('<message role="assistant" id="message-2">') == 1
	for important_fact in ("CURRENT_DECISION_ID_42", "config.yml", "timeout=45", "/api/reports", "never expose PII"):
		assert important_fact in result


def test_branch_summary_size_metrics_handle_first_summary_and_growth():
	import app.main as main_module

	message = SimpleNamespace(id="message-1", role="user", content="M" * 40)
	first = main_module._branch_summary_size_metrics(None, [message], "S" * 20)
	assert first == {
		"previous_summary_chars": 0,
		"new_summary_chars": 20,
		"summary_growth_percent": None,
		"summary_compression_ratio": 0.5,
		"summary_growth_warning": False,
	}

	grown = main_module._branch_summary_size_metrics(
		SimpleNamespace(summary_text="P" * 100),
		[message],
		"N" * 160,
	)
	assert grown == {
		"previous_summary_chars": 100,
		"new_summary_chars": 160,
		"summary_growth_percent": 60.0,
		"summary_compression_ratio": 1.1429,
		"summary_growth_warning": True,
	}


def test_branch_summary_growth_warning_does_not_reject_completed_summary(monkeypatch, caplog):
	import asyncio

	import app.main as main_module

	previous_text = "P" * 100
	message_text = "M" * 40
	completed_summary = "N" * 160
	completions = SummaryResultCompletions(completed_summary, "stop")
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module, "settings", replace(
		main_module.settings,
		app_env="development",
		summary_debug_metrics=True,
	))

	with caplog.at_level("INFO"):
		result = asyncio.run(main_module._generate_branch_summary(
			SimpleNamespace(summary_text=previous_text),
			[SimpleNamespace(id="message-1", role="user", content=message_text)],
			correlation_id="growth-warning",
		))

	assert result == completed_summary
	assert len(completions.calls) == 1
	metric = json.loads(next(
		record.getMessage()
		for record in caplog.records
		if record.name == "uvicorn.error" and '"event": "BRANCH_SUMMARY_METRICS"' in record.getMessage()
	))
	assert metric["result"] == "accepted"
	assert metric["finish_reason"] == "stop"
	assert metric["previous_summary_chars"] == 100
	assert metric["new_summary_chars"] == 160
	assert metric["summary_growth_percent"] == 60.0
	assert metric["summary_compression_ratio"] == 1.1429
	assert metric["summary_growth_warning"] is True
	assert any(
		record.name == "velorian" and "Branch summary growth warning" in record.getMessage()
		for record in caplog.records
	)
	all_logs = "\n".join(record.getMessage() for record in caplog.records)
	assert previous_text not in all_logs
	assert message_text not in all_logs
	assert completed_summary not in all_logs


def test_branch_summary_rejects_length_finish_reason_but_keeps_metrics(monkeypatch, caplog):
	import asyncio

	import app.main as main_module

	completions = SummaryResultCompletions("INCOMPLETE_SUMMARY", "length")
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module, "settings", replace(
		main_module.settings,
		app_env="development",
		summary_debug_metrics=True,
	))
	message = SimpleNamespace(id="message-1", role="user", content="Important batch")

	with caplog.at_level("INFO"):
		result = asyncio.run(main_module._generate_branch_summary(None, [message]))

	assert result is None
	metric = json.loads(next(
		record.getMessage() for record in caplog.records if "BRANCH_SUMMARY_METRICS" in record.getMessage()
	))
	assert metric["finish_reason"] == "length"
	assert metric["summary_input_tokens"] == 30
	assert metric["summary_output_tokens"] == 10
	assert metric["status"] == "success"
	assert metric["result"] == "discarded_length"
	assert not metric["summary_persisted"]
	assert any("incomplete summary discarded" in record.getMessage() for record in caplog.records)


def test_branch_summary_length_failure_does_not_advance_coverage(authenticated_client, monkeypatch):
	import asyncio
	from uuid import uuid4

	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	completions = SummaryResultCompletions("INCOMPLETE_SUMMARY", "length")
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Summary coverage"},
	).json()["conversation"]["id"]
	with SessionLocal() as db:
		covered = Message(id=str(uuid4()), conversation_id=conversation_id, role="user", content="COVERED")
		newly_excluded = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="assistant",
			content="NEWLY_EXCLUDED", reply_to_id=covered.id,
		)
		current = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="CURRENT", reply_to_id=newly_excluded.id,
		)
		db.add_all([covered, newly_excluded, current])
		db.flush()
		existing = BranchSummary(
			conversation_id=conversation_id,
			branch_anchor_message_id=current.id,
			summarized_through_message_id=covered.id,
			summary_text="EXISTING_SUMMARY",
		)
		db.add(existing)
		db.flush()
		covered_id = covered.id
		existing_id = existing.id
		db.commit()

		updated = asyncio.run(main_module._update_branch_summary(
			db,
			conversation_id,
			current,
			[newly_excluded],
		))
		summaries = list(db.scalars(
			select(BranchSummary).where(BranchSummary.conversation_id == conversation_id)
		))

	assert not updated
	assert len(summaries) == 1
	assert summaries[0].id == existing_id
	assert summaries[0].summarized_through_message_id == covered_id
	assert summaries[0].summary_text == "EXISTING_SUMMARY"


def test_branch_summary_provider_errors_return_no_summary(monkeypatch):
	import asyncio

	import app.main as main_module

	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	errors = (
		summary_provider_status_error(413),
		summary_provider_status_error(429),
		APITimeoutError(request=request),
	)
	message = SimpleNamespace(id="message-1", role="user", content="Important context")
	for error in errors:
		completions = SequencedBranchSummaryCompletions([error])
		monkeypatch.setattr(main_module, "client", FakeGroq(completions))

		result = asyncio.run(main_module._generate_branch_summary(None, [message]))

		assert result is None
		assert len(completions.summary_calls) == 1


def test_branch_summary_retries_one_short_rate_limit_then_succeeds(monkeypatch):
	import asyncio

	import app.main as main_module

	completions = SequencedBranchSummaryCompletions([
		summary_provider_status_error(429, "1"),
		("RETRIED_SUMMARY", "stop"),
	])
	waits: list[float] = []

	async def record_sleep(seconds: float):
		waits.append(seconds)

	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module.asyncio, "sleep", record_sleep)
	message = SimpleNamespace(id="message-1", role="user", content="Important context")

	result = asyncio.run(main_module._generate_branch_summary(None, [message]))

	assert result == "RETRIED_SUMMARY"
	assert waits == [1.0]
	assert len(completions.summary_calls) == 2
	assert completions.summary_calls[0] == completions.summary_calls[1]


def test_branch_summary_does_not_wait_for_long_rate_limit(monkeypatch):
	import asyncio

	import app.main as main_module

	completions = SequencedBranchSummaryCompletions([summary_provider_status_error(429, "30")])

	async def unexpected_sleep(_seconds: float):
		raise AssertionError("Long Retry-After must not be awaited")

	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module.asyncio, "sleep", unexpected_sleep)
	message = SimpleNamespace(id="message-1", role="user", content="Important context")

	result = asyncio.run(main_module._generate_branch_summary(None, [message]))

	assert result is None
	assert len(completions.summary_calls) == 1


def test_branch_summary_stops_after_repeated_short_rate_limit(monkeypatch):
	import asyncio

	import app.main as main_module

	completions = SequencedBranchSummaryCompletions([
		summary_provider_status_error(429, "1"),
		summary_provider_status_error(429, "1"),
	])
	waits: list[float] = []

	async def record_sleep(seconds: float):
		waits.append(seconds)

	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module.asyncio, "sleep", record_sleep)
	message = SimpleNamespace(id="message-1", role="user", content="Important context")

	result = asyncio.run(main_module._generate_branch_summary(None, [message]))

	assert result is None
	assert waits == [1.0]
	assert len(completions.summary_calls) == 2


def test_branch_summary_cancellation_during_rate_limit_wait_is_propagated(monkeypatch):
	import asyncio

	import app.main as main_module

	completions = SequencedBranchSummaryCompletions([summary_provider_status_error(429, "1")])

	async def cancel_sleep(_seconds: float):
		raise asyncio.CancelledError

	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module.asyncio, "sleep", cancel_sleep)
	message = SimpleNamespace(id="message-1", role="user", content="Important context")

	with pytest.raises(asyncio.CancelledError):
		asyncio.run(main_module._generate_branch_summary(None, [message]))

	assert len(completions.summary_calls) == 1


def test_chat_is_blocked_when_evicted_history_summary_fails(authenticated_client, monkeypatch):
	import app.main as main_module

	base_settings = main_module.settings
	for completions in (
		SummaryResultCompletions("INCOMPLETE_SUMMARY", "length"),
		SequencedBranchSummaryCompletions([summary_provider_status_error(413)]),
	):
		monkeypatch.setattr(main_module, "client", FakeGroq())
		monkeypatch.setattr(main_module, "settings", replace(base_settings, history_token_budget=72000))
		conversation_id = authenticated_client.post(
			"/api/conversations", json={"title": "Safe summary failure"},
		).json()["conversation"]["id"]
		for prompt in ("DINOSAUR_FACT_A", "DINOSAUR_FACT_B", "DINOSAUR_FACT_C"):
			response = authenticated_client.post(
				f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt},
			)
			assert response.status_code == 200

		monkeypatch.setattr(main_module, "client", FakeGroq(completions))
		monkeypatch.setattr(main_module, "settings", replace(base_settings, history_token_budget=1))
		response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream", data={"prompt": "Recall the dinosaurs"},
		)

		assert response.status_code == 503
		assert response.json()["error"]["code"] == "BRANCH_SUMMARY_UNAVAILABLE"
		assert completions.stream_calls == []


def test_large_branch_summary_is_batched_in_order_and_within_request_budget(authenticated_client, monkeypatch):
	import asyncio
	from uuid import uuid4

	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	base_input_tokens = main_module._branch_summary_request_input_tokens(None, [])
	request_budget = base_input_tokens + 900
	outcomes = [(f"SUMMARY_{index}", "stop") for index in range(30)]
	completions = SequencedBranchSummaryCompletions(outcomes)
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(main_module, "settings", replace(
		main_module.settings,
		branch_summary_max_output_tokens=128,
		branch_summary_request_token_budget=request_budget,
	))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Large summary batch"},
	).json()["conversation"]["id"]
	markers = ["OVERSIZED_0", "FACT_1", "FACT_2", "FACT_3", "FACT_4"]
	contents = [markers[0] + " " + ("X" * 5000), *(
		marker + " " + ("Y" * 500) for marker in markers[1:]
	)]
	with SessionLocal() as db:
		messages: list[Message] = []
		message_ids: list[str] = []
		parent_id = None
		for index, content in enumerate(contents):
			message_id = str(uuid4())
			message = Message(
				id=message_id,
				conversation_id=conversation_id,
				role="user" if index % 2 == 0 else "assistant",
				content=content,
				reply_to_id=parent_id,
			)
			db.add(message)
			messages.append(message)
			message_ids.append(message_id)
			parent_id = message.id
		current = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="CURRENT", reply_to_id=parent_id,
		)
		db.add(current)
		db.commit()

		updated = asyncio.run(main_module._update_branch_summary(
			db, conversation_id, current, messages,
		))
		summaries = list(db.scalars(
			select(BranchSummary)
			.where(BranchSummary.conversation_id == conversation_id)
			.order_by(BranchSummary.created_at, BranchSummary.id)
		))

	assert updated
	assert len(completions.summary_calls) > len(summaries)
	assert len(summaries) >= 2
	assert summaries[-1].summarized_through_message_id == message_ids[-1]
	positions = {message_id: index for index, message_id in enumerate(message_ids)}
	assert [positions[summary.summarized_through_message_id] for summary in summaries] == sorted(
		positions[summary.summarized_through_message_id] for summary in summaries
	)
	input_budget = main_module._branch_summary_input_token_budget()
	for call in completions.summary_calls:
		assert sum(main_module.estimate_tokens(item["content"]) + 8 for item in call["messages"]) <= input_budget
	first_seen = {
		marker: next(
			index for index, call in enumerate(completions.summary_calls)
			if marker in call["messages"][1]["content"]
		)
		for marker in markers
	}
	assert list(first_seen.values()) == sorted(first_seen.values())


def test_branch_summary_recovery_resumes_after_saved_boundary(authenticated_client, monkeypatch):
	import asyncio
	from uuid import uuid4

	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Summary recovery"},
	).json()["conversation"]["id"]
	with SessionLocal() as db:
		messages: list[Message] = []
		message_ids: list[str] = []
		parent_id = None
		for index in range(4):
			message_id = str(uuid4())
			message = Message(
				id=message_id, conversation_id=conversation_id,
				role="user" if index % 2 == 0 else "assistant",
				content=f"RECOVERY_{index} " + ("Z" * 500), reply_to_id=parent_id,
			)
			db.add(message)
			messages.append(message)
			message_ids.append(message_id)
			parent_id = message.id
		current = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="CURRENT", reply_to_id=parent_id,
		)
		db.add(current)
		db.commit()

		one_message_input = main_module._branch_summary_request_input_tokens(None, [messages[0]])
		monkeypatch.setattr(main_module, "settings", replace(
			main_module.settings,
			branch_summary_max_output_tokens=128,
			branch_summary_request_token_budget=(
				one_message_input + 128 + main_module.BRANCH_SUMMARY_REQUEST_TOKEN_MARGIN + 8
			),
		))
		first_attempt = SequencedBranchSummaryCompletions([
			("PARTIAL_SAVED", "stop"),
			summary_provider_status_error(429),
		])
		monkeypatch.setattr(main_module, "client", FakeGroq(first_attempt))
		assert asyncio.run(main_module._update_branch_summary(
			db, conversation_id, current, messages,
		))
		first_summaries = list(db.scalars(
			select(BranchSummary).where(BranchSummary.conversation_id == conversation_id)
		))
		assert len(first_summaries) == 1
		covered_through_id = first_summaries[0].summarized_through_message_id
		covered_position = message_ids.index(covered_through_id)

		second_attempt = SequencedBranchSummaryCompletions([
			(f"RECOVERED_{index}", "stop") for index in range(10)
		])
		monkeypatch.setattr(main_module, "client", FakeGroq(second_attempt))
		assert asyncio.run(main_module._update_branch_summary(
			db, conversation_id, current, messages,
		))
		all_summaries = list(db.scalars(
			select(BranchSummary)
			.where(BranchSummary.conversation_id == conversation_id)
			.order_by(BranchSummary.created_at, BranchSummary.id)
		))

	covered_markers = {f"RECOVERY_{index}" for index in range(covered_position + 1)}
	second_inputs = "\n".join(call["messages"][1]["content"] for call in second_attempt.summary_calls)
	assert all(marker not in second_inputs for marker in covered_markers)
	assert all_summaries[-1].summarized_through_message_id == message_ids[-1]


def test_branch_summaries_stay_scoped_and_do_not_duplicate_raw_groq_history(authenticated_client, monkeypatch):
	import asyncio

	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	completions = ScopedBranchSummaryCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Scoped summaries"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	for prompt in ("COMMON_OLD", "LEFT_ROOT", "LEFT_FRESH"):
		authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	left_root = next(message for message in messages if message["content"] == "LEFT_ROOT")
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "RIGHT_ROOT", "edit_message_id": left_root["id"]},
	)
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "RIGHT_FRESH"})
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	right_root = next(message for message in messages if message["content"] == "RIGHT_ROOT")
	monkeypatch.setattr(main_module, "settings", replace(main_module.settings, history_token_budget=1))

	actual_calls: dict[str, dict] = {}
	for branch, root, prompt in (
		("RIGHT", right_root, "RIGHT_TRIGGER_1"),
		("LEFT", left_root, "LEFT_TRIGGER_1"),
		("RIGHT", right_root, "RIGHT_TRIGGER_2"),
		("LEFT", left_root, "LEFT_TRIGGER_2"),
	):
		assert authenticated_client.patch(f"/api/messages/{root['id']}/activate").status_code == 200
		response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt},
		)
		assert '"type": "done"' in response.text
		actual_calls[prompt] = completions.stream_calls[-1]
		summary_messages = [
			message["content"] for message in actual_calls[prompt]["messages"]
			if message["role"] == "system" and message["content"].startswith(main_module.BRANCH_SUMMARY_CONTEXT_PREFIX)
		]
		assert summary_messages == [
			main_module.BRANCH_SUMMARY_CONTEXT_PREFIX
			+ f"{branch}_SUMMARY_{1 if prompt.endswith('_1') else 2}"
		]
		assert all(f"{'LEFT' if branch == 'RIGHT' else 'RIGHT'}_SUMMARY_" not in content for content in summary_messages)

	assert [call["branch"] for call in completions.summary_calls] == ["RIGHT", "LEFT", "RIGHT", "LEFT"]
	assert "COMMON_OLD" in completions.summary_calls[0]["input"]
	assert "COMMON_OLD" in completions.summary_calls[1]["input"]
	for call in completions.summary_calls:
		other_branch = "LEFT" if call["branch"] == "RIGHT" else "RIGHT"
		assert f"{other_branch}_ROOT" not in call["input"]
		assert f"{other_branch}_FRESH" not in call["input"]
		assert f"{other_branch}_TRIGGER" not in call["input"]

	with SessionLocal() as db:
		conversation_messages = list(db.scalars(
			select(Message)
			.where(Message.conversation_id == conversation_id)
			.order_by(Message.created_at, Message.id)
		))
		messages_by_content = {message.content: message for message in conversation_messages}
		left_path = main_module._message_path(conversation_messages, messages_by_content["LEFT_TRIGGER_2"].id)
		right_path = main_module._message_path(conversation_messages, messages_by_content["RIGHT_TRIGGER_2"].id)
		summaries = list(db.scalars(
			select(BranchSummary)
			.where(BranchSummary.conversation_id == conversation_id)
			.order_by(BranchSummary.created_at, BranchSummary.id)
		))
		assert len(summaries) == 4
		for summary in summaries:
			branch = "LEFT" if summary.summary_text.startswith("LEFT_") else "RIGHT"
			own_path = left_path if branch == "LEFT" else right_path
			other_path = right_path if branch == "LEFT" else left_path
			assert main_module._branch_summary_applies(summary, own_path)
			assert not main_module._branch_summary_applies(summary, other_path)
			path_ids = [message.id for message in own_path]
			through_index = path_ids.index(summary.summarized_through_message_id)
			anchor_index = path_ids.index(summary.branch_anchor_message_id)
			assert through_index < anchor_index
			covered_messages = own_path[:through_index + 1]
			assert covered_messages[-1].id == summary.summarized_through_message_id
			anchor_content = own_path[anchor_index].content
			raw_contents = {
				message["content"] for message in actual_calls[anchor_content]["messages"]
				if message["role"] != "system"
			}
			assert raw_contents.isdisjoint({message.content for message in covered_messages})

		latest_left = messages_by_content["LEFT_TRIGGER_2"]
		_, _, _, excluded_history = main_module.build_chat_context(
			db, conversation_id, user_id, latest_left.content, latest_left,
		)
		left_path_ids = [message.id for message in left_path]
		latest_left_summary = max(
			(summary for summary in summaries if summary.summary_text.startswith("LEFT_")),
			key=lambda summary: left_path_ids.index(summary.summarized_through_message_id),
		)
		through_index = left_path_ids.index(latest_left_summary.summarized_through_message_id)
		already_summarized_history = left_path[:through_index + 1]
		summary_call_count = len(completions.summary_calls)
		assert excluded_history == []
		assert not asyncio.run(main_module._update_branch_summary(
			db, conversation_id, latest_left, already_summarized_history,
		))
		assert len(completions.summary_calls) == summary_call_count


def test_chat_context_uses_branch_summary_then_fresh_raw_history(authenticated_client, caplog):
	from uuid import uuid4

	import app.main as main_module
	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Summary context"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		a = Message(id=str(uuid4()), conversation_id=conversation_id, role="user", content="A")
		b = Message(id=str(uuid4()), conversation_id=conversation_id, role="assistant", content="B", reply_to_id=a.id)
		c = Message(id=str(uuid4()), conversation_id=conversation_id, role="assistant", content="C", reply_to_id=b.id)
		d = Message(id=str(uuid4()), conversation_id=conversation_id, role="user", content="D", reply_to_id=c.id)
		e = Message(id=str(uuid4()), conversation_id=conversation_id, role="assistant", content="E", reply_to_id=d.id)
		f = Message(id=str(uuid4()), conversation_id=conversation_id, role="user", content="F", reply_to_id=e.id)
		db.add_all([a, b, c, d, e, f])
		db.flush()
		db.add(BranchSummary(
			conversation_id=conversation_id,
			branch_anchor_message_id=f.id,
			summarized_through_message_id=c.id,
			summary_text="Summary of A B C",
		))
		db.commit()

		with caplog.at_level("INFO", logger="uvicorn.error"):
			context, _, _, excluded_history = main_module.build_chat_context(
				db, conversation_id, user_id, "F", f,
			)

	assert context[0] == {"role": "system", "content": main_module.CHAT_PROMPT}
	assert context[1] == {
		"role": "system",
		"content": main_module.BRANCH_SUMMARY_CONTEXT_PREFIX + "Summary of A B C",
	}
	assert [(message["role"], message["content"]) for message in context[2:]] == [
		("user", "D"),
		("assistant", "E"),
		("user", "F"),
	]
	assert excluded_history == []

	context_log = next(
		record.getMessage() for record in reversed(caplog.records)
		if record.getMessage().startswith("AI context size ")
	)
	values = {
		name: int(next(part for part in context_log.split() if part.startswith(f"{name}=")).split("=", 1)[1])
		for name in ("system_tokens", "summary_tokens", "history_tokens", "memory_tokens", "knowledge_tokens", "user_tokens", "total_tokens")
	}
	assert values["summary_tokens"] == main_module.estimate_tokens(context[1]["content"])
	assert values["total_tokens"] == sum(value for name, value in values.items() if name != "total_tokens")


def test_chat_context_rejects_summary_from_sibling_branch(authenticated_client):
	from uuid import uuid4

	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Sibling summary isolation"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		a = Message(id=str(uuid4()), conversation_id=conversation_id, role="user", content="A")
		b = Message(id=str(uuid4()), conversation_id=conversation_id, role="assistant", content="B", reply_to_id=a.id)
		c = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="C OLD_C_UNIQUE_FACT", reply_to_id=b.id, is_active=False,
		)
		d = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="assistant",
			content="D OLD_D_UNIQUE_FACT", reply_to_id=c.id,
		)
		c2 = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="C2", reply_to_id=b.id, is_active=True,
		)
		db.add_all([a, b, c, d, c2])
		db.flush()
		db.add(BranchSummary(
			conversation_id=conversation_id,
			branch_anchor_message_id=c.id,
			summarized_through_message_id=d.id,
			summary_text="SIBLING_SUMMARY_WITH_C_D_FACTS",
		))
		db.commit()

		context, _, _, _ = main_module.build_chat_context(
			db, conversation_id, user_id, "C2", c2,
		)
		conversation_messages = list(db.scalars(
			select(Message)
			.where(Message.conversation_id == conversation_id)
			.order_by(Message.created_at, Message.id)
		))
		active_path = main_module._message_path(conversation_messages, c2.id)

	assert [message.content for message in active_path] == ["A", "B", "C2"]
	assert [(message["role"], message["content"]) for message in context[1:]] == [
		("user", "A"),
		("assistant", "B"),
		("user", "C2"),
	]
	serialized_context = "\n".join(message["content"] for message in context)
	assert "SIBLING_SUMMARY_WITH_C_D_FACTS" not in serialized_context
	assert "OLD_C_UNIQUE_FACT" not in serialized_context
	assert "OLD_D_UNIQUE_FACT" not in serialized_context


def test_chat_context_builder_limits_history_by_total_context_budget(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	current_prompt = "D" * 2
	summary_tokens = main_module.estimate_tokens(
		main_module.BRANCH_SUMMARY_CONTEXT_PREFIX + "SUMMARY_OLD_ACTIVE"
	)
	chat_context_budget = (
		main_module.estimate_tokens(main_module.CHAT_PROMPT)
		+ summary_tokens
		+ main_module.estimate_tokens(current_prompt)
		+ 15
	)
	completions = BranchSummaryCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	monkeypatch.setattr(
		main_module,
		"settings",
		replace(main_module.settings, chat_context_budget=chat_context_budget, history_token_budget=1000),
	)
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Context budget"}).json()["conversation"]["id"]

	with caplog.at_level("INFO", logger="uvicorn.error"):
		for prompt in ("A" * 120, "B" * 8, "C" * 4, current_prompt):
			authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})

	selected_messages = completions.stream_calls[-1]["messages"]
	assert selected_messages[0] == {"role": "system", "content": main_module.CHAT_PROMPT}
	assert [(message["role"], message["content"]) for message in selected_messages[1:] if message["role"] != "system"] == [
		("user", "C" * 4),
		("assistant", "Привет, мир!"),
		("user", current_prompt),
	]

	context_logs = [record.getMessage() for record in caplog.records if record.getMessage().startswith("AI context size ")]
	total_tokens = int(next(part for part in context_logs[-1].split() if part.startswith("total_tokens=")).split("=", 1)[1])
	assert total_tokens <= chat_context_budget


def test_pre_stream_context_error_finalizes_assistant_and_next_request_continues(authenticated_client, monkeypatch):
	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.errors import AppError
	from app.models import Message

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	original_build_chat_context = main_module.build_chat_context
	should_fail = True

	def fail_first_context_build(*args, **kwargs):
		nonlocal should_fail
		if should_fail:
			should_fail = False
			raise AppError(413, "CONTEXT_TOO_LARGE", "Контекст диалога превышает допустимый лимит")
		return original_build_chat_context(*args, **kwargs)

	monkeypatch.setattr(main_module, "build_chat_context", fail_first_context_build)
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Pre-stream lifecycle"},
	).json()["conversation"]["id"]
	request_id = "pre-stream-context-too-large"
	failed = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "FIRST_USER_MESSAGE"},
		headers={"X-Request-ID": request_id},
	)

	assert failed.status_code == 413
	assert failed.json()["error"]["code"] == "CONTEXT_TOO_LARGE"
	assert failed.json()["error"]["request_id"] == request_id
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	assert [(message["role"], message["status"]) for message in conversation["messages"]] == [
		("user", "done"),
		("assistant", "error"),
	]
	failed_assistant = conversation["messages"][1]
	assert failed_assistant["error"]["code"] == "CONTEXT_TOO_LARGE"
	assert failed_assistant["error"]["requestId"] == request_id

	succeeded = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "SECOND_USER_MESSAGE"},
	)
	assert succeeded.status_code == 200
	assert '"type": "done"' in succeeded.text
	user_context = [
		message["content"] for message in completions.calls[-1]["messages"] if message["role"] == "user"
	]
	assert user_context == ["SECOND_USER_MESSAGE"]
	assert all(
		"Контекст диалога превышает допустимый лимит" not in message["content"]
		for message in completions.calls[-1]["messages"]
	)

	with SessionLocal() as db:
		messages = list(db.scalars(
			select(Message)
			.where(Message.conversation_id == conversation_id)
			.order_by(Message.created_at, Message.id)
		))
		assert not any(message.status == "streaming" for message in messages)
		assert [message.content for message in main_module._message_path(messages, messages[-1].id) if message.role == "user"] == [
			"FIRST_USER_MESSAGE", "SECOND_USER_MESSAGE",
		]


def test_failed_turn_is_excluded_from_next_ai_history(authenticated_client, monkeypatch):
	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.errors import AppError
	from app.models import Message

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Failed turn history"},
	).json()["conversation"]["id"]
	first_prompt = "Расскажи кратко про Vue"
	failed_prompt = "Расскажи кратко про React"
	current_prompt = "Ответь одним словом: работает"
	assert authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream", data={"prompt": first_prompt},
	).status_code == 200

	original_build_chat_context = main_module.build_chat_context
	should_fail = True

	def fail_next_context_build(*args, **kwargs):
		nonlocal should_fail
		if should_fail:
			should_fail = False
			raise AppError(413, "CONTEXT_TOO_LARGE", "Контекст диалога превышает допустимый лимит")
		return original_build_chat_context(*args, **kwargs)

	monkeypatch.setattr(main_module, "build_chat_context", fail_next_context_build)
	failed = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream", data={"prompt": failed_prompt},
	)
	assert failed.status_code == 413
	assert failed.json()["error"]["code"] == "CONTEXT_TOO_LARGE"
	succeeded = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream", data={"prompt": current_prompt},
	)
	assert succeeded.status_code == 200
	assert '"type": "done"' in succeeded.text

	ai_messages = completions.calls[-1]["messages"]
	assert [(message["role"], message["content"]) for message in ai_messages[1:]] == [
		("user", first_prompt),
		("assistant", "Привет, мир!"),
		("user", current_prompt),
	]
	assert all(failed_prompt not in message["content"] for message in ai_messages)
	assert all("Контекст диалога превышает допустимый лимит" not in message["content"] for message in ai_messages)

	with SessionLocal() as db:
		messages = list(db.scalars(
			select(Message)
			.where(Message.conversation_id == conversation_id)
			.order_by(Message.created_at, Message.id)
		))
		branch_path = main_module._message_path(messages, messages[-1].id)
		assert [message.content for message in branch_path if message.role == "user"] == [
			first_prompt, failed_prompt, current_prompt,
		]
		failed_user = next(message for message in branch_path if message.content == failed_prompt)
		failed_assistant = next(
			message for message in branch_path
			if message.role == "assistant" and message.reply_to_id == failed_user.id
		)
		assert failed_assistant.status == "error"
		assert failed_assistant.error_code == "CONTEXT_TOO_LARGE"


def test_chat_context_builder_drops_optional_knowledge_before_required_context_and_recent_history(authenticated_client, monkeypatch, caplog):
	import app.main as main_module
	from sqlalchemy import select

	from app.database import SessionLocal
	from app.models import BranchSummary, Message

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Context priorities"}).json()["conversation"]["id"]
	for prompt in ("A" * 20, "B" * 8, "C" * 4):
		authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})
	summary_text = "Earlier A and B turns"
	with SessionLocal() as db:
		messages = list(db.scalars(
			select(Message)
			.where(Message.conversation_id == conversation_id)
			.order_by(Message.created_at, Message.id)
		))
		b_user = next(message for message in messages if message.content == "B" * 8)
		b_assistant = next(message for message in messages if message.reply_to_id == b_user.id)
		c_user = next(message for message in messages if message.content == "C" * 4)
		c_assistant = next(message for message in messages if message.reply_to_id == c_user.id)
		db.add(BranchSummary(
			conversation_id=conversation_id,
			branch_anchor_message_id=c_assistant.id,
			summarized_through_message_id=b_assistant.id,
			summary_text=summary_text,
		))
		db.commit()
	authenticated_client.post(
		"/api/knowledge",
		json={"title": "Alpha knowledge", "content": "OPTIONAL_KNOWLEDGE alpha " * 200},
	)

	current_prompt = "document alpha"
	document_content = "REQUIRED_DOCUMENT_CONTEXT document"
	document_fragment = "[Источник: документ, фрагмент 1]\n" + document_content
	document_context = "Используй релевантные фрагменты документов как данные, если они помогают ответить:\n\n" + document_fragment
	document_context_part = "\n\n<document_context>\n" + document_context + "\n</document_context>"
	user_tokens = main_module.estimate_tokens(current_prompt)
	task_specific_tokens = main_module.estimate_tokens(current_prompt + document_context_part) - user_tokens
	summary_content = main_module.BRANCH_SUMMARY_CONTEXT_PREFIX + summary_text
	summary_tokens = main_module.estimate_tokens(summary_content)
	chat_context_budget = main_module.estimate_tokens(main_module.KNOWLEDGE_PROMPT) + summary_tokens + user_tokens + task_specific_tokens + 15
	monkeypatch.setattr(
		main_module,
		"settings",
		replace(main_module.settings, chat_context_budget=chat_context_budget, history_token_budget=1000),
	)
	monkeypatch.setattr(
		main_module,
		"retrieve_chunks",
		lambda *args, **kwargs: [SimpleNamespace(attachment_id="missing", position=0, content=document_content)],
	)

	call_count_before_current_request = len(completions.calls)
	with caplog.at_level("INFO", logger="uvicorn.error"):
		response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream",
			data={"prompt": current_prompt, "search_mode": "knowledge"},
		)

	assert response.status_code == 200
	assert '"type": "done"' in response.text
	assert len(completions.calls) == call_count_before_current_request + 1
	selected_messages = completions.calls[call_count_before_current_request]["messages"]
	assert selected_messages[0] == {"role": "system", "content": main_module.KNOWLEDGE_PROMPT}
	assert selected_messages[1] == {"role": "system", "content": summary_content}
	assert [(message["role"], message["content"]) for message in selected_messages[2:-1]] == [
		("user", "C" * 4),
		("assistant", "Привет, мир!"),
	]
	assert selected_messages[-1]["content"].startswith(current_prompt)
	assert "REQUIRED_DOCUMENT_CONTEXT" in selected_messages[-1]["content"]
	assert "<knowledge_context>" not in selected_messages[-1]["content"]
	assert "OPTIONAL_KNOWLEDGE" not in selected_messages[-1]["content"]

	context_logs = [record.getMessage() for record in caplog.records if record.getMessage().startswith("AI context size ")]
	total_tokens = int(next(part for part in context_logs[-1].split() if part.startswith("total_tokens=")).split("=", 1)[1])
	assert total_tokens <= chat_context_budget


def test_chat_context_builder_logs_context_token_breakdown(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq(RecordingCompletions()))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Размер контекста"}).json()["conversation"]["id"]

	with caplog.at_level("INFO", logger="uvicorn.error"):
		for prompt in ("Первый вопрос", "Второй вопрос", "Третий вопрос"):
			authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})
		authenticated_client.post("/api/knowledge", json={"title": "Альфа", "content": "Справочный материал альфа"})
		authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream",
			data={"prompt": "Расскажи про альфа", "search_mode": "knowledge"},
		)

	context_logs = [record.getMessage() for record in caplog.records if record.getMessage().startswith("AI context size ")]
	assert len(context_logs) == 4

	def token_value(log: str, name: str) -> int:
		return int(next(part for part in log.split() if part.startswith(f"{name}=")).split("=", 1)[1])

	assert token_value(context_logs[0], "history_tokens") == 0
	assert token_value(context_logs[1], "history_tokens") > 0
	assert token_value(context_logs[2], "history_tokens") > token_value(context_logs[1], "history_tokens")
	assert all(token_value(log, "knowledge_tokens") == 0 for log in context_logs[:3])
	assert token_value(context_logs[3], "knowledge_tokens") > 0
	for log in context_logs:
		assert token_value(log, "total_tokens") == sum(
			token_value(log, name)
			for name in ("system_tokens", "summary_tokens", "history_tokens", "memory_tokens", "knowledge_tokens", "user_tokens")
		)


def test_generated_file_is_attached_and_downloadable(authenticated_client, monkeypatch):
	import app.main as main_module

	answer = "```file:hello.py\nprint('Velorian')\n```\n\nФайл готов."
	completions = FixedCompletions(answer)
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Создай файл hello.py"},
	)
	done = next(json.loads(line) for line in response.text.splitlines() if '"type": "done"' in line)
	attachment = done["message"]["attachments"][0]
	assert done["message"]["content"] == "Файл готов."
	assert attachment["name"] == "hello.py"
	assert attachment["generated"] is True
	download = authenticated_client.get(attachment["downloadUrl"])
	assert download.status_code == 200
	assert download.content == b"print('Velorian')"
	assert "attachment" in download.headers["content-disposition"]
	assert completions.calls[0]["messages"][0]["content"] == main_module.FILE_GENERATION_PROMPT


def test_qwen_generated_file_uses_selected_model_and_is_downloadable(authenticated_client, monkeypatch):
	import app.main as main_module
	from app.config import settings

	answer = "```file:qwen-result.txt\nQwen file content\n```\n\nФайл готов."
	completions = FixedCompletions(answer)
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Qwen file"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Создай файл qwen-result.txt", "model_id": "qwen-3.8"},
	)

	done = next(json.loads(line) for line in response.text.splitlines() if '"type": "done"' in line)
	attachment = done["message"]["attachments"][0]
	assert completions.calls[-1]["model"] == settings.groq_qwen_model
	assert done["message"]["modelId"] == "qwen-3.8"
	assert attachment["name"] == "qwen-result.txt"
	assert authenticated_client.get(attachment["downloadUrl"]).content == b"Qwen file content"


def test_file_request_pattern_recognizes_explicit_natural_phrases():
	from app.main import FILE_REQUEST_PATTERN

	for prompt in (
		"Создай мне файлы с результатами",
		"Предоставь результат отдельным файлом",
		"Мне нужен документ с итогами",
		"Подготовь результат в CSV",
		"Generate files with the report",
	):
		assert FILE_REQUEST_PATTERN.search(prompt), prompt
	assert FILE_REQUEST_PATTERN.search("Напиши простенький скрипт на node js") is None


def test_generated_file_count_limit_returns_error_without_partial_attachments(authenticated_client, monkeypatch):
	import app.main as main_module
	from app.config import settings

	answer = "\n".join(
		f"```file:result-{index}.txt\n{index}\n```"
		for index in range(settings.max_files + 1)
	)
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(answer)))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "File limit"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Создай файлы с результатами"},
	)

	events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
	assert events[-1]["type"] == "error"
	assert events[-1]["code"] == "ATTACHMENT_COUNT_LIMIT_EXCEEDED"
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	assert messages[-1]["status"] == "error"
	assert messages[-1]["attachments"] == []


def test_code_request_does_not_create_file_without_explicit_file_intent(authenticated_client, monkeypatch):
	import app.main as main_module

	answer = "```file:app.js\nconsole.log('Hello');\n```\n\nГотово."
	completions = FixedCompletions(answer)
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Напиши простенький скрипт на node js"},
	)
	done = next(json.loads(line) for line in response.text.splitlines() if '"type": "done"' in line)
	assert done["message"]["attachments"] == []
	assert done["message"]["content"] == "```javascript\nconsole.log('Hello');\n```\n\nГотово."
	assert completions.calls[0]["messages"][0]["content"] != main_module.FILE_GENERATION_PROMPT


def test_automatic_title_is_short_and_has_no_emoji(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "🚀 Подробно расскажи про архитектуру большого современного приложения и способы тестирования"},
	)
	title = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["title"]
	assert title == "Архитектура большого современного приложения"
	assert len(title) <= 48


def test_automatic_title_uses_semantic_summary_of_first_message(authenticated_client, monkeypatch):
	import app.main as main_module

	class SemanticTitleCompletions(FakeCompletions):
		def __init__(self):
			self.title_call = None

		async def create(self, **kwargs):
			if not kwargs.get("stream", False) and kwargs["messages"][0]["content"] == main_module.TITLE_PROMPT:
				self.title_call = kwargs
				return SimpleNamespace(choices=[SimpleNamespace(
					message=SimpleNamespace(content='Заголовок: "Перевод промпта на английский."'),
				)])
			return await super().create(**kwargs)

	completions = SemanticTitleCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]
	first_message = "переведи промпт на английский, не меняя формулировок и ничего не добавляя от себя"
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": first_message},
	)

	title = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["title"]
	assert title == "Перевод промпта на английский"
	assert completions.title_call["messages"][1] == {"role": "user", "content": first_message}
	assert completions.title_call["max_completion_tokens"] == 128
	assert completions.title_call["reasoning_effort"] == "low"
	assert completions.title_call["include_reasoning"] is False
	title_prompt = completions.title_call["messages"][0]["content"]
	assert title_prompt == main_module.TITLE_PROMPT


def test_semantic_title_is_not_truncated_after_generation():
	from app.main import _normalize_generated_title

	title = "Login by email or login through one form"
	assert _normalize_generated_title(title) == title


def test_automatic_title_summarizes_code_request():
	from app.main import _clean_title

	assert _clean_title("напиши простенький скрипт на node js") == "Простой скрипт на Node.js"


def test_sanitizes_heading_emoji_without_touching_code():
	from app.main import _sanitize_markdown_headings

	content = "##\u202f1️⃣ 🚀 Настройка\n\n```md\n## 🚀 Код\n```"
	assert _sanitize_markdown_headings(content) == "## 1. Настройка\n\n```md\n## 🚀 Код\n```"


def test_rejects_unsupported_file(authenticated_client):
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Файлы"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверь"},
		files={"files": ("archive.zip", b"content", "application/zip")},
	)
	assert response.status_code == 415
	assert response.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"


def test_rejects_attachment_count_with_structured_code_and_diagnostics(authenticated_client, monkeypatch):
	import app.main as main_module
	from app.config import settings

	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Лимит файлов"}).json()["conversation"]["id"]
	files = [("files", (f"file-{index}.txt", b"x", "text/plain")) for index in range(settings.max_files + 1)]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверь файлы"},
		files=files,
	)
	assert response.status_code == 413
	error = response.json()["error"]
	assert error["code"] == "ATTACHMENT_COUNT_LIMIT_EXCEEDED"
	assert error["details"] == {
		"actualAttachments": settings.max_files + 1,
		"maximumAttachments": settings.max_files,
	}
	assert authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"] == []


def test_rejects_broken_supported_file(authenticated_client):
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Файлы"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверь"},
		files={"files": ("broken.pdf", b"not a pdf", "application/pdf")},
	)
	assert response.status_code == 422
	assert response.json()["error"]["code"] == "FILE_PROCESSING_FAILED"


def test_large_inline_text_becomes_utf8_attachment(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]
	large_text = "Юникод и переносы\n" + "важные данные " * 1000
	response = authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": large_text})
	assert '"type": "done"' in response.text
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	user_message = conversation["messages"][0]
	assert user_message["content"] == ""
	assert user_message["attachments"][0]["name"].startswith("pasted-text-")
	assert user_message["attachments"][0]["name"].endswith(".txt")
	assert "Юникод и переносы" in completions.calls[0]["messages"][-1]["content"]


def test_stream_error_is_persisted_as_error_status(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions("")))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Ошибка"}).json()["conversation"]["id"]
	response = authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Пустой ответ"})
	assert '"type": "error"' in response.text
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	assert messages[-1]["status"] == "error"
	assert messages[-1]["role"] == "assistant"
	assert messages[-1]["error"]["code"] == "AI_EMPTY_RESPONSE"
	assert messages[-1]["error"]["requestId"]


def test_rating_upsert_delete_and_no_duplicates(authenticated_client, monkeypatch):
	from app.database import SessionLocal
	from app.models import MessageRating

	import app.main as main_module
	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Рейтинг"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Ответь"})
	message_id = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]["id"]

	created = authenticated_client.put(f"/api/messages/{message_id}/rating", json={"score": 4, "comment": "Полезно"})
	assert created.status_code == 200
	assert created.json()["rating"]["score"] == 4
	updated = authenticated_client.put(f"/api/messages/{message_id}/rating", json={"score": 5, "comment": "Отлично"})
	assert updated.json()["rating"]["score"] == 5
	with SessionLocal() as db:
		assert db.query(MessageRating).filter(MessageRating.message_id == message_id).count() == 1
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	assert conversation["messages"][-1]["rating"]["comment"] == "Отлично"
	assert authenticated_client.delete(f"/api/messages/{message_id}/rating").status_code == 204


def test_cannot_rate_another_users_message(client, monkeypatch):
	import app.main as main_module
	monkeypatch.setattr(main_module, "client", FakeGroq())
	first = client.post("/api/auth/register", json={"login": "rating-owner", "email": "rating-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": first.json()["csrfToken"]})
	conversation_id = client.post("/api/conversations", json={"title": "Чужой"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Ответ"})
	message_id = client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]["id"]
	client.post("/api/auth/logout")
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	second = client.post("/api/auth/register", json={"login": "rating-other", "email": "rating-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	response = client.put(f"/api/messages/{message_id}/rating", json={"score": 5})
	assert response.status_code == 404


def test_knowledge_manual_file_rated_message_and_ownership(client, monkeypatch):
	import app.main as main_module
	monkeypatch.setattr(main_module, "client", FakeGroq())
	first = client.post("/api/auth/register", json={"login": "knowledge-owner", "email": "knowledge-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": first.json()["csrfToken"]})
	manual = client.post("/api/knowledge", json={"title": "Тестовый материал", "content": "Проверенный текст"})
	assert manual.status_code == 200
	manual_id = manual.json()["item"]["id"]
	file_item = client.post("/api/knowledge/files", data={"title": "Файл"}, files={"file": ("notes.txt", "данные файла".encode(), "text/plain")})
	assert file_item.status_code == 200
	file_payload = file_item.json()["item"]
	assert file_payload["content"] == "данные файла"
	assert file_payload["metadata"]["extractionStatus"] == "ready"
	assert client.get(f"/api/knowledge/{file_payload['id']}/file").content == "данные файла".encode()
	assert [item["id"] for item in client.get("/api/knowledge?search=NOTES.TXT").json()["items"]] == [file_payload["id"]]

	conversation_id = client.post("/api/conversations", json={"title": "Знания"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Полезный ответ"})
	message_id = client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]["id"]
	client.put(f"/api/messages/{message_id}/rating", json={"score": 4})
	saved = client.post(f"/api/knowledge/messages/{message_id}")
	assert saved.status_code == 200
	assert saved.json()["items"][0]["sourceType"] == "rated_content"

	updated = client.patch(f"/api/knowledge/{manual_id}", json={"title": "Новый материал", "content": "Новый текст", "is_active": False})
	assert updated.json()["item"]["isActive"] is False
	assert len(client.get("/api/knowledge?search=Новый").json()["items"]) == 1

	client.post("/api/auth/logout")
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	second = client.post("/api/auth/register", json={"login": "knowledge-other", "email": "knowledge-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	assert client.get(f"/api/knowledge/{manual_id}").status_code == 404
	assert client.patch(f"/api/knowledge/{manual_id}", json={"title": "Взлом"}).status_code == 404
	assert client.delete(f"/api/knowledge/{manual_id}").status_code == 404
	assert client.get(f"/api/knowledge/{file_payload['id']}/file").status_code == 404


def test_knowledge_file_upload_uses_edited_title_and_content(authenticated_client):
	file_bytes = "исходный текст файла".encode()
	files = {"file": ("draft.txt", file_bytes, "text/plain")}
	data = {"title": "Отредактированный заголовок", "content": "Отредактированное содержимое"}

	created = authenticated_client.post("/api/knowledge/files", data=data, files=files)
	assert created.status_code == 200
	assert created.json()["item"]["title"] == data["title"]
	assert created.json()["item"]["content"] == data["content"]
	assert created.json()["item"]["fileName"] == "draft.txt"
	assert authenticated_client.get(f"/api/knowledge/{created.json()['item']['id']}/file").content == file_bytes
	assert authenticated_client.get(f"/api/knowledge/{created.json()['item']['id']}/file?original=true").content == file_bytes

	duplicate = authenticated_client.post("/api/knowledge/files", data=data, files=files)
	assert duplicate.status_code == 200
	assert duplicate.json()["item"]["id"] != created.json()["item"]["id"]

	edited = authenticated_client.post(
		"/api/knowledge/files",
		data={"title": "Ещё один заголовок", "content": "Ещё одна редакция"},
		files=files,
	)
	assert edited.status_code == 200
	assert edited.json()["item"]["content"] == "Ещё одна редакция"


def test_manual_knowledge_file_updates_keep_first_manual_version_as_original(authenticated_client):
	created = authenticated_client.post(
		"/api/knowledge",
		json={"title": "Ручной оригинал", "content": "первоначальный ручной текст"},
	).json()["item"]

	first_update = authenticated_client.put(
		f"/api/knowledge/{created['id']}/file",
		data={"title": "Первая файловая версия", "content": "отредактированное содержимое первой версии"},
		files={"file": ("first.txt", "первая текущая версия".encode(), "text/plain")},
	)
	assert first_update.status_code == 200
	assert first_update.json()["item"]["sourceType"] == "uploaded_file"
	assert first_update.json()["item"]["content"] == "отредактированное содержимое первой версии"
	assert first_update.json()["item"]["fileName"] == "first.txt"
	assert first_update.json()["item"]["originalFilename"] == "Ручной оригинал.md"
	assert first_update.json()["item"]["originalDownloadUrl"] is not None
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file").content == "первая текущая версия".encode()
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file?original=true").content == "первоначальный ручной текст".encode()

	second_update = authenticated_client.put(
		f"/api/knowledge/{created['id']}/file",
		data={"title": "Вторая файловая версия"},
		files={"file": ("second.txt", "вторая текущая версия".encode(), "text/plain")},
	)
	assert second_update.status_code == 200
	assert second_update.json()["item"]["fileName"] == "second.txt"
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file").content == "вторая текущая версия".encode()
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file?original=true").content == "первоначальный ручной текст".encode()


def test_manual_knowledge_edits_keep_first_version_as_original(authenticated_client):
	created = authenticated_client.post(
		"/api/knowledge",
		json={"title": "Ручной оригинал", "content": "первоначальный ручной текст"},
	).json()["item"]

	assert created["originalDownloadUrl"] is not None
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file").content == "первоначальный ручной текст".encode()
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file?original=true").content == "первоначальный ручной текст".encode()

	for title, content in (("Первая версия", "первое изменение"), ("Последняя версия", "последнее изменение")):
		updated = authenticated_client.patch(
			f"/api/knowledge/{created['id']}",
			json={"title": title, "content": content},
		)
		assert updated.status_code == 200
		assert authenticated_client.get(f"/api/knowledge/{created['id']}/file").content == content.encode()
		assert authenticated_client.get(f"/api/knowledge/{created['id']}/file?original=true").content == "первоначальный ручной текст".encode()


def test_uploaded_knowledge_manual_edits_download_as_current_version(authenticated_client):
	created = authenticated_client.post(
		"/api/knowledge/files",
		files={"file": ("original.txt", b"first uploaded file", "text/plain")},
	).json()["item"]

	updated = authenticated_client.patch(
		f"/api/knowledge/{created['id']}",
		json={"title": "Отредактировано", "content": "текущая ручная версия"},
	)
	assert updated.status_code == 200
	assert updated.json()["item"]["fileName"] == "Отредактировано.md"
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file").content == "текущая ручная версия".encode()
	assert authenticated_client.get(f"/api/knowledge/{created['id']}/file?original=true").content == b"first uploaded file"


def test_uploaded_knowledge_file_updates_keep_first_file_as_original(authenticated_client):
	created = authenticated_client.post(
		"/api/knowledge/files",
		files={"file": ("original.txt", b"first uploaded file", "text/plain")},
	).json()["item"]

	for name, content in (("second.txt", b"second uploaded file"), ("third.txt", b"third uploaded file")):
		updated = authenticated_client.put(
			f"/api/knowledge/{created['id']}/file",
			files={"file": (name, content, "text/plain")},
		)
		assert updated.status_code == 200
		assert updated.json()["item"]["fileName"] == name
		assert updated.json()["item"]["originalFilename"] == "original.txt"
		current_download = authenticated_client.get(f"/api/knowledge/{created['id']}/file")
		original_download = authenticated_client.get(f"/api/knowledge/{created['id']}/file?original=true")
		assert current_download.content == content
		assert f"filename*=UTF-8''{name}" in current_download.headers["content-disposition"]
		assert original_download.content == b"first uploaded file"
		assert "filename*=UTF-8''original.txt" in original_download.headers["content-disposition"]


def test_knowledge_rating_filters_sort_and_pagination(authenticated_client):
	first = authenticated_client.post("/api/knowledge", json={"title": "Пять", "content": "Высокий рейтинг", "rating": 5})
	second = authenticated_client.post("/api/knowledge", json={"title": "Три", "content": "Средний рейтинг", "rating": 3})
	third = authenticated_client.post("/api/knowledge", json={"title": "Без оценки", "content": "Нет рейтинга"})
	assert first.status_code == second.status_code == third.status_code == 200
	assert authenticated_client.post("/api/knowledge", json={"title": "Ошибка", "content": "Невалидно", "rating": 6}).status_code == 422
	for invalid_rating in (0, -1, 3.7, "5"):
		assert authenticated_client.post("/api/knowledge", json={"title": "Ошибка", "content": "Невалидно", "rating": invalid_rating}).status_code == 422

	high = authenticated_client.get("/api/knowledge?min_rating=4&sort=rating_desc").json()
	assert [item["title"] for item in high["items"]] == ["Пять"]
	unrated = authenticated_client.get("/api/knowledge?unrated=true").json()
	assert [item["title"] for item in unrated["items"]] == ["Без оценки"]
	page_one = authenticated_client.get("/api/knowledge?limit=1&sort=rating_desc").json()
	assert page_one["pageInfo"]["hasMore"] is True
	page_two = authenticated_client.get(f"/api/knowledge?limit=1&sort=rating_desc&cursor={page_one['pageInfo']['nextCursor']}").json()
	assert page_two["items"][0]["id"] != page_one["items"][0]["id"]
	updated = authenticated_client.patch(f"/api/knowledge/{second.json()['item']['id']}", json={"rating": 4})
	assert updated.json()["item"]["rating"] == 4
	assert authenticated_client.patch(f"/api/knowledge/{second.json()['item']['id']}", json={"rating": None}).json()["item"]["rating"] is None
	for invalid_rating in (0, 6, -1, 3.7, "5"):
		assert authenticated_client.patch(f"/api/knowledge/{second.json()['item']['id']}", json={"rating": invalid_rating}).status_code == 422


def test_knowledge_activity_sort_and_pagination(authenticated_client):
	for title in ("Активный 1", "Неактивный", "Активный 2"):
		response = authenticated_client.post("/api/knowledge", json={"title": title, "content": title})
		assert response.status_code == 200
		if title == "Неактивный":
			inactive_id = response.json()["item"]["id"]

	assert authenticated_client.patch(f"/api/knowledge/{inactive_id}", json={"is_active": False}).status_code == 200
	active_first = authenticated_client.get("/api/knowledge?sort=activity_desc").json()["items"]
	inactive_first = authenticated_client.get("/api/knowledge?sort=activity_asc").json()["items"]
	assert [item["isActive"] for item in active_first] == [True, True, False]
	assert [item["isActive"] for item in inactive_first] == [False, True, True]

	page_one = authenticated_client.get("/api/knowledge?sort=activity_desc&limit=2").json()
	page_two = authenticated_client.get(
		f"/api/knowledge?sort=activity_desc&limit=2&cursor={page_one['pageInfo']['nextCursor']}"
	).json()
	assert [item["isActive"] for item in page_one["items"]] == [True, True]
	assert [item["isActive"] for item in page_two["items"]] == [False]


def test_knowledge_search_handles_unicode_multiple_terms_and_literals(authenticated_client):
	a = authenticated_client.post("/api/knowledge", json={"title": "Ёлочный ОФФЕР", "content": "Проверенный русский Текст"}).json()["item"]
	authenticated_client.post("/api/knowledge", json={"title": "English Hooks", "content": "Curiosity angle"})
	assert [item["id"] for item in authenticated_client.get("/api/knowledge?search=елочный%20текст").json()["items"]] == [a["id"]]
	assert len(authenticated_client.get("/api/knowledge?search=english").json()["items"]) == 1
	assert authenticated_client.get("/api/knowledge?search=%25").status_code == 200
	assert authenticated_client.get("/api/knowledge?search=_").json()["items"] == []


def test_knowledge_schema_has_non_destructive_constraints_and_indexes():
	from sqlalchemy import inspect

	from app.database import engine

	inspector = inspect(engine)
	columns = {column["name"]: column for column in inspector.get_columns("knowledge_items")}
	assert columns["rating"]["nullable"] is True
	assert columns["approach_id"]["nullable"] is True
	assert columns["is_active"]["nullable"] is False
	assert columns["deleted_at"]["nullable"] is True
	assert columns["current_filename"]["nullable"] is True
	assert columns["current_mime_type"]["nullable"] is True
	assert columns["current_storage_key"]["nullable"] is True
	index_names = {index["name"] for index in inspector.get_indexes("knowledge_items")}
	assert {
		"ix_knowledge_user_active",
		"ix_knowledge_user_source",
		"ix_knowledge_user_rating",
		"ix_knowledge_user_created",
		"ix_knowledge_user_updated",
		"ix_knowledge_items_approach_id",
		"ix_knowledge_user_active_approach",
		"ix_knowledge_items_deleted_at",
	}.issubset(index_names)
	foreign_keys = {fk["constrained_columns"][0]: fk for fk in inspector.get_foreign_keys("knowledge_items")}
	assert foreign_keys["user_id"]["options"]["ondelete"] == "CASCADE"
	assert foreign_keys["source_message_id"]["options"]["ondelete"] == "SET NULL"
	assert foreign_keys["source_file_id"]["options"]["ondelete"] == "SET NULL"
	assert foreign_keys["approach_id"]["options"]["ondelete"] == "SET NULL"
	approach_indexes = {index["name"] for index in inspector.get_indexes("knowledge_approaches")}
	approach_columns = {column["name"]: column for column in inspector.get_columns("knowledge_approaches")}
	assert approach_columns["rating"]["nullable"] is True
	assert {
		"ix_knowledge_approaches_user_id",
		"ix_knowledge_approach_user_name",
		"ix_knowledge_approach_user_rating",
	}.issubset(approach_indexes)
	conversation_columns = {column["name"]: column for column in inspector.get_columns("conversations")}
	assert conversation_columns["deleted_at"]["nullable"] is True
	assert "ix_conversations_deleted_at" in {index["name"] for index in inspector.get_indexes("conversations")}


def test_knowledge_file_delete_failure_preserves_database_item(authenticated_client, monkeypatch):
	import app.knowledge as knowledge_module

	created = authenticated_client.post(
		"/api/knowledge/files",
		files={"file": ("keep.txt", b"keep this data", "text/plain")},
	).json()["item"]
	real_storage = knowledge_module.get_file_storage()

	class FailingDeleteStorage:
		async def get(self, key):
			return await real_storage.get(key)

		async def delete(self, key):
			raise OSError("simulated storage failure")

	assert authenticated_client.delete(f"/api/knowledge/{created['id']}").status_code == 204
	monkeypatch.setattr(knowledge_module, "get_file_storage", lambda: FailingDeleteStorage())
	response = authenticated_client.delete(f"/api/knowledge/trash/{created['id']}")
	assert response.status_code == 503
	assert response.json()["error"]["code"] == "KNOWLEDGE_FILE_DELETE_FAILED"
	assert created["id"] in {
		item["id"] for item in authenticated_client.get("/api/knowledge/trash").json()["items"]
	}


def test_knowledge_search_is_opt_in_and_owner_scoped(client, monkeypatch):
	import app.main as main_module

	owner = client.post("/api/auth/register", json={"login": "retrieval-owner", "email": "retrieval-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": owner.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Альфа", "content": "Собственный секрет альфа", "rating": 5})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	other = client.post("/api/auth/register", json={"login": "retrieval-other", "email": "retrieval-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": other.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Чужое", "content": "Чужой секрет альфа", "rating": 5})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	login = client.post("/api/auth/login", json={"identifier": "retrieval-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": login.json()["csrfToken"]})

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = client.post("/api/conversations", json={"title": "Поиск знаний"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Расскажи про альфа", "search_mode": "none"})
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Расскажи про альфа", "search_mode": "knowledge"})
	assert completions.calls[0]["messages"][0]["content"] == main_module.CHAT_PROMPT
	assert completions.calls[1]["messages"][0]["content"] == main_module.KNOWLEDGE_PROMPT
	assert "<knowledge_context>" not in completions.calls[0]["messages"][-1]["content"]
	knowledge_prompt = completions.calls[1]["messages"][-1]["content"]
	assert "Собственный секрет альфа" in knowledge_prompt
	assert "Чужой секрет альфа" not in knowledge_prompt
	conversation = client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	knowledge_user_message = [message for message in conversation["messages"] if message["role"] == "user"][-1]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"retry_message_id": knowledge_user_message["id"]})
	retry_prompt = completions.calls[2]["messages"][-1]["content"]
	assert "Собственный секрет альфа" in retry_prompt
	assert "Чужой секрет альфа" not in retry_prompt


def test_knowledge_list_intent_browses_metadata_without_toggle(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Список знаний"}).json()["conversation"]["id"]

	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Что находится в моей базе знаний?", "search_mode": "none"},
	)
	empty_context = completions.calls[0]["messages"][-1]["content"]
	assert "Mode: list" in empty_context
	assert "Status: empty" in empty_context
	assert "пока нет активных данных" in empty_context

	authenticated_client.post("/api/knowledge", json={
		"title": "Facebook Hooks",
		"content": "Для health-офферов используем curiosity angle.",
		"rating": 5,
	})
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Какие материалы есть в моей базе знаний?", "search_mode": "none"},
	)
	list_context = completions.calls[1]["messages"][-1]["content"]
	assert "Mode: list" in list_context
	assert "Source: Facebook Hooks" in list_context
	assert "Rating: 5/5" in list_context
	assert "curiosity angle" in list_context
	assert "user_id" not in list_context
	assert "storage_key" not in list_context


def test_knowledge_list_intent_is_owner_scoped(client, monkeypatch):
	import app.main as main_module

	owner = client.post("/api/auth/register", json={"login": "list-owner", "email": "list-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": owner.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Owner Material", "content": "owner-only knowledge"})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	other = client.post("/api/auth/register", json={"login": "list-other", "email": "list-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": other.json()["csrfToken"]})

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = client.post("/api/conversations", json={"title": "Изоляция списка"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Что находится в моей базе знаний?"})
	context = completions.calls[0]["messages"][-1]["content"]
	assert "Status: empty" in context
	assert "Owner Material" not in context
	assert "owner-only knowledge" not in context


def test_three_active_items_retrieval_browse_toggle_and_sources(authenticated_client, monkeypatch):
	import app.main as main_module
	from app.knowledge_retrieval import detect_knowledge_intent

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Полный retrieval"}).json()["conversation"]["id"]
	created = [
		authenticated_client.post("/api/knowledge", json={
			"title": "Facebook Hooks", "content": "Для health-офферов используем curiosity angle.", "rating": 1,
		}).json()["item"],
		authenticated_client.post("/api/knowledge", json={
			"title": "Italy Advertorial", "content": "Для Италии лучше работают advertorial с историей клиента.", "rating": 5,
		}).json()["item"],
		authenticated_client.post("/api/knowledge", json={
			"title": "Push Creatives", "content": "В push используются короткие эмоциональные заголовки.",
		}).json()["item"],
	]

	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Какие подходы есть для Facebook?", "search_mode": "knowledge"},
	)
	assert response.status_code == 200
	search_context = completions.calls[-1]["messages"][-1]["content"]
	assert "Status: found" in search_context
	assert "Active items: 3" in search_context
	assert "Source: Facebook Hooks" in search_context
	assert "Rating: 1/5" in search_context
	assert "Italy Advertorial" not in search_context
	assert "user_id" not in search_context
	assert "storage_key" not in search_context
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	sources = conversation["messages"][-1]["knowledgeSources"]
	assert sources == [{
		"id": created[0]["id"], "title": "Facebook Hooks", "sourceType": "manual", "rating": 1, "approach": None,
	}]

	for prompt in ("что ты видишь в бд?", "напиши про все доступные тебе данные", "там три ячейки есть с данными"):
		assert detect_knowledge_intent(prompt, explicit_search=True) == "list"
		authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream",
			data={"prompt": prompt, "search_mode": "knowledge"},
		)
		browse_context = completions.calls[-1]["messages"][-1]["content"]
		assert "Mode: list" in browse_context
		assert "Active items: 3" in browse_context
		assert all(f"Source: {item['title']}" in browse_context for item in created)
	assert detect_knowledge_intent("Что агент видит в базе?", explicit_search=False) == "list"
	assert detect_knowledge_intent("Какие данные по Facebook?", explicit_search=True) == "search"

	authenticated_client.patch(f"/api/knowledge/{created[0]['id']}", json={"is_active": False})
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Facebook curiosity", "search_mode": "knowledge"},
	)
	inactive_context = completions.calls[-1]["messages"][-1]["content"]
	assert "Active items: 2" in inactive_context
	assert "Status: no_relevant_results" in inactive_context
	assert "Facebook Hooks" not in inactive_context

	authenticated_client.patch(f"/api/knowledge/{created[0]['id']}", json={"is_active": True})
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Facebook curiosity", "search_mode": "knowledge"},
	)
	assert "Source: Facebook Hooks" in completions.calls[-1]["messages"][-1]["content"]


def test_message_rating_changes_do_not_update_saved_knowledge(authenticated_client, monkeypatch):
	import app.main as main_module
	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Порог"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Ответ"})
	message_id = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]["id"]
	authenticated_client.put(f"/api/messages/{message_id}/rating", json={"score": 5})
	authenticated_client.post(f"/api/knowledge/messages/{message_id}")
	authenticated_client.put(f"/api/messages/{message_id}/rating", json={"score": 2})
	items = authenticated_client.get("/api/knowledge").json()["items"]
	assert items[0]["isActive"] is True
	assert items[0]["rating"] == 5


def test_knowledge_approach_crud_filter_delete_and_user_isolation(authenticated_client):
	defaults = authenticated_client.get("/api/knowledge/approaches")
	assert defaults.status_code == 200
	assert {item["name"] for item in defaults.json()["items"]} == {"Интервью", "Шоу"}
	foreign_approach_id = defaults.json()["items"][0]["id"]

	created_approach = authenticated_client.post("/api/knowledge/approaches", json={"name": "UGC-разбор"})
	assert created_approach.status_code == 200
	approach = created_approach.json()["item"]
	assert authenticated_client.post("/api/knowledge/approaches", json={"name": "ugc-разбор"}).status_code == 409

	matching = authenticated_client.post("/api/knowledge", json={
		"title": "Активный UGC", "content": "Конкретный материал", "rating": 5,
		"is_active": True, "approach_id": approach["id"],
	}).json()["item"]
	authenticated_client.post("/api/knowledge", json={
		"title": "Выключенный UGC", "content": "Не должен попасть", "rating": 5,
		"is_active": False, "approach_id": approach["id"],
	})
	authenticated_client.post("/api/knowledge", json={
		"title": "Низкий рейтинг", "content": "Не должен попасть", "rating": 2,
		"is_active": True, "approach_id": approach["id"],
	})
	filtered = authenticated_client.get(
		"/api/knowledge", params={"approach_id": approach["id"], "is_active": True, "min_rating": 4},
	)
	assert filtered.status_code == 200
	assert [item["id"] for item in filtered.json()["items"]] == [matching["id"]]
	assert filtered.json()["items"][0]["approach"]["name"] == "UGC-разбор"

	renamed = authenticated_client.patch(f"/api/knowledge/approaches/{approach['id']}", json={"name": "UGC Story"})
	assert renamed.status_code == 200
	assert renamed.json()["item"]["name"] == "UGC Story"
	assert authenticated_client.delete(f"/api/knowledge/approaches/{approach['id']}").status_code == 204
	preserved = authenticated_client.get(f"/api/knowledge/{matching['id']}")
	assert preserved.status_code == 200
	assert preserved.json()["item"]["approach"]["id"] == approach["id"]
	assert preserved.json()["item"]["approach"]["isActive"] is False

	second = authenticated_client.post("/api/auth/register", json={
		"login": "approach-isolation", "email": "approach-isolation@example.com", "password": "strong-password",
	})
	assert second.status_code == 200
	authenticated_client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	assert authenticated_client.get("/api/knowledge", params={"approach_id": foreign_approach_id}).status_code == 404
	assert authenticated_client.post("/api/knowledge", json={
		"title": "Чужой подход", "content": "Запрещено", "approach_id": foreign_approach_id,
	}).status_code == 404


def test_global_approach_crud_preserves_linked_items(authenticated_client):
	example = authenticated_client.post("/api/knowledge", json={
		"title": "Референс", "content": "Пример материала",
	}).json()["item"]
	payload = {
		"name": "Документальный разбор",
		"description": "Спокойный разбор фактов",
		"purpose": "Объяснить тему",
		"characteristics": ["точность", "контекст"],
		"structure": ["введение", "факты", "вывод"],
		"writing_guidelines": ["ссылаться на источники"],
		"avoid": ["сенсационность"],
		"example_knowledge_item_ids": [example["id"]],
		"rating": 4,
		"is_active": True,
	}
	created_response = authenticated_client.post("/api/approaches", json=payload)
	assert created_response.status_code == 201
	created = created_response.json()["item"]
	assert created["writingGuidelines"] == payload["writing_guidelines"]
	assert created["exampleKnowledgeItemIds"] == [example["id"]]
	assert created["rating"] == 4

	linked = authenticated_client.post("/api/knowledge", json={
		"title": "Связанный материал", "content": "Содержимое", "approach_id": created["id"],
	}).json()["item"]
	updated = authenticated_client.patch(f"/api/approaches/{created['id']}", json={
		"description": "Обновлённое описание", "rating": None,
	})
	assert updated.status_code == 200
	assert updated.json()["item"]["description"] == "Обновлённое описание"
	assert updated.json()["item"]["rating"] is None
	assert updated.json()["item"]["isActive"] is True
	assert updated.json()["item"]["linkedKnowledgeItemsCount"] == 1
	for invalid_rating in (0, 6, -1, 3.7, "5"):
		assert authenticated_client.patch(
			f"/api/approaches/{created['id']}", json={"rating": invalid_rating},
		).status_code == 422

	assert authenticated_client.delete(f"/api/approaches/{created['id']}").status_code == 204
	deactivated = authenticated_client.get(f"/api/approaches/{created['id']}")
	assert deactivated.status_code == 200
	assert deactivated.json()["item"]["isActive"] is False
	assert authenticated_client.get(f"/api/knowledge/{linked['id']}").json()["item"]["approach"]["id"] == created["id"]

	disposable = authenticated_client.post("/api/approaches", json={"name": "Временный"}).json()["item"]
	assert authenticated_client.delete(f"/api/approaches/{disposable['id']}").status_code == 204
	assert authenticated_client.get(f"/api/approaches/{disposable['id']}").status_code == 404


def test_dynamic_approach_resolver_scopes_context_and_distinguishes_empty(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	approaches = {item["name"]: item for item in authenticated_client.get("/api/knowledge/approaches").json()["items"]}
	authenticated_client.post("/api/knowledge", json={
		"title": "Начало интервью", "content": "Начать текст нужно с личного вопроса.",
		"approach_id": approaches["Интервью"]["id"],
	})
	authenticated_client.post("/api/knowledge", json={
		"title": "Начало шоу", "content": "Начать текст нужно с яркого конфликта.",
		"approach_id": approaches["Шоу"]["id"],
	})
	empty = authenticated_client.post("/api/knowledge/approaches", json={"name": "Документалистика"}).json()["item"]
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Подходы"}).json()["conversation"]["id"]

	auto = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Как лучше начать текст для подхода Интервью?", "search_mode": "none"},
	)
	assert auto.status_code == 200
	context = completions.calls[-1]["messages"][-1]["content"]
	assert "Filter: Approach = Интервью" in context
	assert "Source: Начало интервью" in context
	assert "Начало шоу" not in context

	browse = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Что у меня есть по Шоу?", "search_mode": "none"},
	)
	assert browse.status_code == 200
	context = completions.calls[-1]["messages"][-1]["content"]
	assert "Mode: list" in context
	assert "Filter: Approach = Шоу" in context
	assert "Source: Начало шоу" in context
	assert "Начало интервью" not in context

	unknown = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Что есть для подхода Несуществующий?", "search_mode": "none"},
	)
	assert unknown.status_code == 200
	assert "Status: approach_not_found" in completions.calls[-1]["messages"][-1]["content"]
	empty_response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": f"Что есть по {empty['name']}?", "search_mode": "none"},
	)
	assert empty_response.status_code == 200
	assert "Status: approach_empty" in completions.calls[-1]["messages"][-1]["content"]


def test_assistant_response_markdown_file_removes_title_and_is_idempotent_and_downloadable(authenticated_client, monkeypatch):
	import app.main as main_module

	markdown = "1. **Ласковый след**\n\nТихий шёпот утра,\nИ хвост, как клятва, виляя,"
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(markdown)))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Markdown"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Напиши материал"})
	message = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]

	created = authenticated_client.post(f"/api/messages/{message['id']}/markdown-file", json={})
	assert created.status_code == 200
	attachment = created.json()["attachment"]
	assert created.json()["created"] is True
	assert attachment["name"] == "Ласковый след.md"
	assert attachment["type"] == "text/markdown"
	assert attachment["generated"] is True
	assert authenticated_client.get(attachment["downloadUrl"]).content.decode() == "Тихий шёпот утра,\nИ хвост, как клятва, виляя,"

	duplicate = authenticated_client.post(f"/api/messages/{message['id']}/markdown-file", json={})
	assert duplicate.status_code == 200
	assert duplicate.json()["created"] is False
	assert duplicate.json()["attachment"]["id"] == attachment["id"]


def test_rated_assistant_response_knowledge_removes_bold_title(authenticated_client, monkeypatch):
	import app.main as main_module

	markdown = "**Poem**\n\nSoftly falls the evening light,\nAnd old winds whisper in the shade."
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(markdown)))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Poem"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Write a poem"})
	message = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]
	assert message["content"] == markdown
	authenticated_client.put(f"/api/messages/{message['id']}/rating", json={"score": 5})

	item = authenticated_client.post(f"/api/knowledge/messages/{message['id']}").json()["items"][0]
	assert item["title"] == "Poem"
	assert item["content"] == "Softly falls the evening light,\nAnd old winds whisper in the shade."


def test_message_editor_knowledge_link_lifecycle_and_file_reuse(authenticated_client, monkeypatch):
	import app.main as main_module

	markdown = "## Связанный материал\n\nТочное содержимое файла."
	body = "Точное содержимое файла."
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(markdown)))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Связь"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Создай материал"})
	message = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]
	attachment = authenticated_client.post(f"/api/messages/{message['id']}/markdown-file", json={}).json()["attachment"]

	created = authenticated_client.post("/api/knowledge", json={
		"title": "Связанный материал",
		"content": body,
		"rating": None,
		"source_message_id": message["id"],
		"source_file_id": attachment["id"],
	})
	assert created.status_code == 200
	item = created.json()["item"]
	assert item["sourceType"] == "assistant_file"
	assert item["sourceMessageId"] == message["id"]
	assert item["sourceFileId"] == attachment["id"]
	assert item["title"] == "Связанный материал"
	assert item["rating"] is None
	assert item["content"] == body
	assert authenticated_client.get(item["originalDownloadUrl"]).content.decode() == body
	assert authenticated_client.get(f"/api/knowledge/messages/{message['id']}/link").json()["item"] == {
		"id": item["id"], "deletedAt": None, "rating": None,
	}
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	assert conversation["messages"][-1]["knowledgeItem"] == {
		"id": item["id"], "deletedAt": None, "rating": None,
	}

	duplicate = authenticated_client.post("/api/knowledge", json={
		"title": "Дубликат", "content": markdown, "source_message_id": message["id"],
	})
	assert duplicate.status_code == 409

	assert authenticated_client.delete(f"/api/knowledge/{item['id']}").status_code == 204
	trashed_link = authenticated_client.get(f"/api/knowledge/messages/{message['id']}/link").json()["item"]
	assert trashed_link["id"] == item["id"]
	assert trashed_link["deletedAt"] is not None
	assert authenticated_client.post(f"/api/knowledge/trash/{item['id']}/restore").status_code == 200
	assert authenticated_client.get(f"/api/knowledge/messages/{message['id']}/link").json()["item"]["deletedAt"] is None

	assert authenticated_client.delete(f"/api/knowledge/{item['id']}").status_code == 204
	assert authenticated_client.delete(f"/api/knowledge/trash/{item['id']}").status_code == 204
	assert authenticated_client.get(f"/api/knowledge/messages/{message['id']}/link").json()["item"] is None
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	assert conversation["messages"][-1]["knowledgeItem"] is None
	assert conversation["messages"][-1]["attachments"][0]["id"] == attachment["id"]
	assert authenticated_client.get(attachment["downloadUrl"]).content.decode() == body


def test_message_editor_text_source_preserves_selected_or_absent_rating(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions("Текст ответа")))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Оценки редактора"}).json()["conversation"]["id"]
	created_ratings = []
	created_ids = []
	for prompt, rating in (("С оценкой", 3), ("Без оценки", None)):
		authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": prompt})
		message = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]
		created = authenticated_client.post("/api/knowledge", json={
			"title": prompt,
			"content": message["content"],
			"rating": rating,
			"source_message_id": message["id"],
		})
		assert created.status_code == 200
		assert created.json()["item"]["sourceType"] == "assistant_message"
		created_ratings.append(created.json()["item"]["rating"])
		created_ids.append(created.json()["item"]["id"])

	assert created_ratings == [3, None]
	filtered = authenticated_client.get("/api/knowledge", params={"source_type": "rated_content"})
	assert {item["id"] for item in filtered.json()["items"]} == set(created_ids)


def test_generated_markdown_file_to_knowledge_filters_and_retrieval(authenticated_client, monkeypatch):
	import app.main as main_module

	markdown = "## Материал 1\n\nНейтральный тестовый текст с **Markdown**."
	body = "Нейтральный тестовый текст с **Markdown**."
	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(markdown)))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Фильтры"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Подготовь текст"})
	message_id = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]["id"]
	attachment = authenticated_client.post(f"/api/messages/{message_id}/markdown-file", json={}).json()["attachment"]
	filters = {
		"geo": "Регион 1", "celebrity": "Персонаж 1",
		"offer": "Предложение 1", "news_source": "Источник 1",
	}
	saved = authenticated_client.post(f"/api/knowledge/attachments/{attachment['id']}", json={"filters": filters})
	assert saved.status_code == 200
	item = saved.json()["item"]
	assert saved.json()["created"] is True
	assert item["sourceType"] == "assistant_file"
	assert item["title"] == "Материал 1"
	assert item["content"] == body
	assert item["mimeType"] == "text/markdown"
	assert item["fileName"] == "Материал 1.md"
	assert item["filters"] == filters
	assert authenticated_client.get(item["downloadUrl"]).content.decode() == body
	filtered = authenticated_client.get("/api/knowledge", params={"source_type": "uploaded_file"})
	assert [entry["id"] for entry in filtered.json()["items"]] == [item["id"]]

	duplicate = authenticated_client.post(f"/api/knowledge/attachments/{attachment['id']}", json={"filters": filters})
	assert duplicate.status_code == 200
	assert duplicate.json()["created"] is False
	assert duplicate.json()["item"]["id"] == item["id"]

	authenticated_client.post("/api/knowledge", json={
		"title": "Другой материал", "content": "Не должен попасть", "filters": {"geo": "Регион 1", "offer": "Другое предложение"},
	})
	for params in (
		{"geo": "Регион 1"},
		{"celebrity": "Персонаж 1"},
		{"offer": "Предложение 1"},
		{"news_source": "Источник 1"},
		{"geo": "Регион 1", "offer": "Предложение 1"},
		filters,
	):
		result = authenticated_client.get("/api/knowledge", params=params)
		assert result.status_code == 200
		assert item["id"] in [entry["id"] for entry in result.json()["items"]]
		if "offer" in params and params["offer"] == "Предложение 1":
			assert [entry["id"] for entry in result.json()["items"]] == [item["id"]]

	# Explicit metadata narrows candidates, while normal lexical retrieval still ranks inside that scope.
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Найди материалы для Региона 1 по Предложению 1", "search_mode": "none"},
	)
	context = completions.calls[-1]["messages"][-1]["content"]
	assert "Filter: Гео = Регион 1" in context
	assert "Filter: Оффер = Предложение 1" in context
	assert "Source: Материал 1.md" in context
	assert "Другой материал" not in context


def test_metadata_filters_are_partial_case_insensitive_and_space_normalized(authenticated_client):
	from app.database import SessionLocal
	from app.knowledge_retrieval import KnowledgeSearchOptions, knowledge_retrieval_service

	item = authenticated_client.post("/api/knowledge", json={
		"title": "Metadata partial match",
		"content": "Материал с метаданными",
		"filters": {
			"geo": "South America",
			"celebrity": "Leonardo DiCaprio",
			"offer": "Summer Special",
			"news_source": "Facebook",
		},
	}).json()["item"]
	for params in (
		{"geo": "  south   america  "},
		{"celebrity": "dicaprio"},
		{"offer": "SUMMER"},
		{"news_source": "facebook"},
	):
		result = authenticated_client.get("/api/knowledge", params=params)
		assert result.status_code == 200
		assert item["id"] in {entry["id"] for entry in result.json()["items"]}

	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		search_result = knowledge_retrieval_service.search(
			db, user_id, KnowledgeSearchOptions(query="", celebrity="  dicaprio  "),
		)
		list_result = knowledge_retrieval_service.list(
			db, user_id, KnowledgeSearchOptions(query="", news_source="FACE"),
		)
	assert item["id"] in {entry.id for entry in search_result.items}
	assert item["id"] in {entry.id for entry in list_result.items}


def test_knowledge_filters_optional_update_clear_and_legacy_record(authenticated_client):
	legacy = authenticated_client.post("/api/knowledge", json={"title": "Старая запись", "content": "## Без фильтров"}).json()["item"]
	assert legacy["filters"] == {"geo": None, "celebrity": None, "offer": None, "news_source": None}
	assert legacy["downloadUrl"]
	updated = authenticated_client.patch(f"/api/knowledge/{legacy['id']}", json={
		"filters": {"geo": "  Казахстан  ", "offer": "Trustenix AI"},
	}).json()["item"]
	assert updated["filters"] == {"geo": "Казахстан", "celebrity": None, "offer": "Trustenix AI", "news_source": None}
	cleared = authenticated_client.patch(f"/api/knowledge/{legacy['id']}", json={"filters": None}).json()["item"]
	assert cleared["filters"] == {"geo": None, "celebrity": None, "offer": None, "news_source": None}


def test_markdown_file_name_sanitizes_cross_platform_characters():
	from app.markdown_files import markdown_file_name, split_markdown_title, unique_markdown_file_name

	name = markdown_file_name('Тихий / вечер\\: ?* "тест"')
	assert name.endswith(".md")
	assert not any(character in name for character in '<>:"/\\|?*')
	assert unique_markdown_file_name("article", {"article.md", "ARTICLE-2.MD"}) == "article-3.md"
	assert split_markdown_title("**Poem**\n\nSoftly falls\nunchanged") == ("Poem", "Softly falls\nunchanged")
	assert split_markdown_title("1. **Ласковый след**\n\nТихий шёпот утра") == ("Ласковый след", "Тихий шёпот утра")
	plain = "Softly falls\nunchanged"
	assert split_markdown_title(plain) == ("Softly falls", plain)
	ordered_item = "1. Обычный пункт\n2. Следующий пункт"
	assert split_markdown_title(ordered_item)[1] == ordered_item


def test_csrf_rejects_missing_invalid_and_rotated_tokens(client):
	valid = client.headers.pop("X-CSRF-Token")
	missing = client.post("/api/conversations", json={"title": "Нет токена"})
	assert missing.status_code == 403
	assert missing.json()["error"]["code"] == "CSRF_INVALID"
	client.headers.update({"X-CSRF-Token": "invalid"})
	assert client.post("/api/conversations", json={"title": "Плохой токен"}).status_code == 403
	client.headers.update({"X-CSRF-Token": valid})
	registered = client.post("/api/auth/register", json={"login": "csrf-user", "email": "csrf@example.com", "password": "strong-password"})
	assert registered.status_code == 200
	rotated = registered.json()["csrfToken"]
	assert rotated != valid
	assert client.post("/api/conversations", json={"title": "Старый токен"}).status_code == 403
	client.headers.update({"X-CSRF-Token": rotated})
	assert client.post("/api/conversations", json={"title": "Новый токен"}).status_code == 200
