import json
from types import SimpleNamespace

import httpx
from groq import APIStatusError


class FakeCompletions:
	async def create(self, **kwargs):
		async def chunks():
			for content in ("Привет", ", мир!"):
				yield SimpleNamespace(
					choices=[SimpleNamespace(delta=SimpleNamespace(content=content))],
				)
		return chunks()


class FakeGroq:
	def __init__(self, completions=None):
		self.chat = SimpleNamespace(completions=completions or FakeCompletions())


class RecordingCompletions(FakeCompletions):
	def __init__(self):
		self.calls: list[dict] = []

	async def create(self, **kwargs):
		self.calls.append(kwargs)
		return await super().create(**kwargs)


class FixedCompletions:
	def __init__(self, content: str):
		self.content = content

	async def create(self, **kwargs):
		async def chunks():
			yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=self.content))])
		return chunks()


class ContextRejectingCompletions(RecordingCompletions):
	async def create(self, **kwargs):
		self.calls.append(kwargs)
		if len(kwargs["messages"]) > 2:
			request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
			response = httpx.Response(500, request=request)
			raise APIStatusError("context rejected", response=response, body={"error": "test"})
		return await FakeCompletions.create(self, **kwargs)


def install_structured_intents(monkeypatch, main_module, resolver):
	from app.agent_intent import AgentIntent

	async def resolve(_db, _user_id, prompt, **_kwargs):
		payload = resolver(prompt)
		return AgentIntent(**payload)

	monkeypatch.setattr(main_module, "resolve_agent_intent", resolve)


def test_auth_session_and_structured_error(client):
	unauthorized = client.get("/api/conversations")
	assert unauthorized.status_code == 401
	assert unauthorized.json()["error"]["code"] == "AUTH_REQUIRED"

	registered = client.post(
		"/api/auth/register",
		json={"email": "first@example.com", "password": "strong-password"},
	)
	assert registered.status_code == 200
	assert registered.json()["user"]["email"] == "first@example.com"
	client.headers.update({"X-CSRF-Token": registered.json()["csrfToken"]})
	assert client.get("/api/auth/me").status_code == 200

	client.post("/api/auth/logout")
	assert client.get("/api/auth/me").status_code == 401
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	login = client.post(
		"/api/auth/login",
		json={"email": "first@example.com", "password": "strong-password"},
	)
	assert login.status_code == 200
	client.headers.update({"X-CSRF-Token": login.json()["csrfToken"]})

	validation = client.post("/api/auth/login", json={"email": "a", "password": "x"})
	assert validation.status_code == 422
	assert validation.json()["error"]["code"] == "VALIDATION_ERROR"


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


def test_public_config_exposes_canonical_attachment_limits(client):
	from app.config import settings

	response = client.get("/api/config")
	assert response.status_code == 200
	assert response.json()["attachmentLimits"] == {
		"maxAttachments": settings.max_files,
		"maxFileSize": settings.max_file_size,
		"maxTotalSize": settings.max_total_file_size,
	}


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


def test_retries_rejected_history_with_compact_context(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = ContextRejectingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Контекст"}).json()["conversation"]["id"]

	first = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Первый вопрос"},
	)
	assert '"type": "done"' in first.text

	second = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Продолжи"},
	)

	assert '"type": "done"' in second.text
	assert len(completions.calls) == 3
	assert [message["role"] for message in completions.calls[1]["messages"]] == ["system", "user", "assistant", "user"]
	assert [message["role"] for message in completions.calls[2]["messages"]] == ["system", "user"]


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

	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Ветки"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Первая версия"})
	original = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][0]

	edited = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Изменённая версия", "edit_message_id": original["id"]},
	)
	assert '"type": "done"' in edited.text
	messages = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
	user_versions = [message for message in messages if message["role"] == "user"]
	assert len(user_versions) == 2
	assert user_versions[0]["branchGroupId"] == user_versions[1]["branchGroupId"]
	assert [message["isActive"] for message in user_versions] == [False, True]

	activated = authenticated_client.patch(f"/api/messages/{original['id']}/activate")
	assert activated.status_code == 200
	user_versions = [
		message
		for message in authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"]
		if message["role"] == "user"
	]
	assert [message["isActive"] for message in user_versions] == [True, False]


def test_generated_file_is_attached_and_downloadable(authenticated_client, monkeypatch):
	import app.main as main_module

	answer = "```file:hello.py\nprint('Velorian')\n```\n\nФайл готов."
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(answer)))
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


def test_code_request_does_not_create_file_without_explicit_file_intent(authenticated_client, monkeypatch):
	import app.main as main_module

	answer = "```file:app.js\nconsole.log('Hello');\n```\n\nГотово."
	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(answer)))
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый чат"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Напиши простенький скрипт на node js"},
	)
	done = next(json.loads(line) for line in response.text.splitlines() if '"type": "done"' in line)
	assert done["message"]["attachments"] == []
	assert done["message"]["content"] == "```javascript\nconsole.log('Hello');\n```\n\nГотово."


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
	first = client.post("/api/auth/register", json={"email": "rating-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": first.json()["csrfToken"]})
	conversation_id = client.post("/api/conversations", json={"title": "Чужой"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Ответ"})
	message_id = client.get(f"/api/conversations/{conversation_id}").json()["conversation"]["messages"][-1]["id"]
	client.post("/api/auth/logout")
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	second = client.post("/api/auth/register", json={"email": "rating-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	response = client.put(f"/api/messages/{message_id}/rating", json={"score": 5})
	assert response.status_code == 404


def test_knowledge_manual_file_rated_message_and_ownership(client, monkeypatch):
	import app.main as main_module
	monkeypatch.setattr(main_module, "client", FakeGroq())
	first = client.post("/api/auth/register", json={"email": "knowledge-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": first.json()["csrfToken"]})
	manual = client.post("/api/knowledge", json={"title": "Оффер", "content": "Проверенный текст"})
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

	updated = client.patch(f"/api/knowledge/{manual_id}", json={"title": "Новый оффер", "content": "Новый текст", "is_active": False})
	assert updated.json()["item"]["isActive"] is False
	assert len(client.get("/api/knowledge?search=Новый").json()["items"]) == 1

	client.post("/api/auth/logout")
	csrf = client.get("/api/auth/csrf").json()["csrfToken"]
	client.headers.update({"X-CSRF-Token": csrf})
	second = client.post("/api/auth/register", json={"email": "knowledge-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	assert client.get(f"/api/knowledge/{manual_id}").status_code == 404
	assert client.patch(f"/api/knowledge/{manual_id}", json={"title": "Взлом"}).status_code == 404
	assert client.delete(f"/api/knowledge/{manual_id}").status_code == 404
	assert client.get(f"/api/knowledge/{file_payload['id']}/file").status_code == 404


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
	index_names = {index["name"] for index in inspector.get_indexes("knowledge_items")}
	assert {
		"ix_knowledge_user_active",
		"ix_knowledge_user_source",
		"ix_knowledge_user_rating",
		"ix_knowledge_user_created",
		"ix_knowledge_user_updated",
		"ix_knowledge_items_approach_id",
		"ix_knowledge_user_active_approach",
	}.issubset(index_names)
	foreign_keys = {fk["constrained_columns"][0]: fk for fk in inspector.get_foreign_keys("knowledge_items")}
	assert foreign_keys["user_id"]["options"]["ondelete"] == "CASCADE"
	assert foreign_keys["source_message_id"]["options"]["ondelete"] == "SET NULL"
	assert foreign_keys["approach_id"]["options"]["ondelete"] == "SET NULL"
	approach_indexes = {index["name"] for index in inspector.get_indexes("knowledge_approaches")}
	assert {"ix_knowledge_approaches_user_id", "ix_knowledge_approach_user_name"}.issubset(approach_indexes)
	definition_columns = {column["name"] for column in inspector.get_columns("knowledge_filter_definitions")}
	assert "normalized_name" in definition_columns
	definition_uniques = {constraint["name"] for constraint in inspector.get_unique_constraints("knowledge_filter_definitions")}
	assert "uq_knowledge_filter_definition_user_normalized_name" in definition_uniques
	value_uniques = {constraint["name"] for constraint in inspector.get_unique_constraints("knowledge_item_filter_values")}
	assert "uq_knowledge_item_filter_option" in value_uniques
	value_indexes = {index["name"] for index in inspector.get_indexes("knowledge_item_filter_values")}
	assert {"ix_knowledge_item_filter_lookup", "ix_knowledge_item_filter_values_filter_option_id"}.issubset(value_indexes)
	alias_indexes = {index["name"] for index in inspector.get_indexes("knowledge_filter_option_aliases")}
	assert {"ix_knowledge_filter_option_alias_lookup", "ix_knowledge_filter_option_aliases_filter_option_id"}.issubset(alias_indexes)


def test_multiselect_migration_rebuilds_legacy_sqlite_join_without_losing_links():
	from sqlalchemy import create_engine, inspect, text

	from app.migrations import _upgrade_knowledge_filter_multiselect

	legacy = create_engine("sqlite:///:memory:")
	with legacy.begin() as connection:
		connection.execute(text("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)"))
		connection.execute(text("CREATE TABLE knowledge_items (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36))"))
		connection.execute(text("CREATE TABLE knowledge_filter_definitions (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), name VARCHAR(80), slug VARCHAR(96), type VARCHAR(24), is_system BOOLEAN, created_at DATETIME, updated_at DATETIME)"))
		connection.execute(text("CREATE TABLE knowledge_filter_options (id VARCHAR(36) PRIMARY KEY, filter_definition_id VARCHAR(36), value VARCHAR(120), normalized_value VARCHAR(140), created_at DATETIME, updated_at DATETIME)"))
		connection.execute(text("CREATE TABLE knowledge_item_filter_values (id VARCHAR(36) PRIMARY KEY, knowledge_item_id VARCHAR(36), filter_definition_id VARCHAR(36), filter_option_id VARCHAR(36), created_at DATETIME, CONSTRAINT uq_knowledge_item_filter_definition UNIQUE (knowledge_item_id, filter_definition_id))"))
		connection.execute(text("INSERT INTO users VALUES ('user-1')"))
		connection.execute(text("INSERT INTO knowledge_items VALUES ('item-1', 'user-1')"))
		connection.execute(text("INSERT INTO knowledge_filter_definitions VALUES ('filter-1', 'user-1', ' ГЕО ', 'geo', 'single_select', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
		connection.execute(text("INSERT INTO knowledge_filter_options VALUES ('option-1', 'filter-1', ' Brazil ', 'brazil', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
		connection.execute(text("INSERT INTO knowledge_item_filter_values VALUES ('link-1', 'item-1', 'filter-1', 'option-1', CURRENT_TIMESTAMP)"))
		_upgrade_knowledge_filter_multiselect(connection)
		assert connection.scalar(text("SELECT normalized_name FROM knowledge_filter_definitions WHERE id='filter-1'")) == "гео"
		assert connection.scalar(text("SELECT normalized_value FROM knowledge_filter_options WHERE id='option-1'")) == "brazil"
		assert connection.scalar(text("SELECT COUNT(*) FROM knowledge_item_filter_values WHERE id='link-1'")) == 1
		unique_names = {constraint["name"] for constraint in inspect(connection).get_unique_constraints("knowledge_item_filter_values")}
		assert "uq_knowledge_item_filter_option" in unique_names


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

	monkeypatch.setattr(knowledge_module, "get_file_storage", lambda: FailingDeleteStorage())
	response = authenticated_client.delete(f"/api/knowledge/{created['id']}")
	assert response.status_code == 503
	assert response.json()["error"]["code"] == "KNOWLEDGE_FILE_DELETE_FAILED"
	assert authenticated_client.get(f"/api/knowledge/{created['id']}").status_code == 200


def test_knowledge_search_is_opt_in_and_owner_scoped(client, monkeypatch):
	import app.main as main_module

	owner = client.post("/api/auth/register", json={"email": "retrieval-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": owner.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Альфа", "content": "Собственный секрет альфа", "rating": 5})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	other = client.post("/api/auth/register", json={"email": "retrieval-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": other.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Чужое", "content": "Чужой секрет альфа", "rating": 5})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	login = client.post("/api/auth/login", json={"email": "retrieval-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": login.json()["csrfToken"]})

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = client.post("/api/conversations", json={"title": "Поиск знаний"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Расскажи про альфа", "search_mode": "none"})
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Расскажи про альфа", "search_mode": "knowledge"})
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
	install_structured_intents(monkeypatch, main_module, lambda prompt: {
		"action": "knowledge_search", "knowledge_intent": "list", "knowledge_query": prompt,
	})
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Список знаний"}).json()["conversation"]["id"]

	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Что находится в моей базе знаний?", "search_mode": "none"},
	)
	empty_context = completions.calls[0]["messages"][-1]["content"]
	assert "Mode: list" in empty_context
	assert "Status: KNOWLEDGE_EMPTY" in empty_context
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
	assert "Title: Facebook Hooks" in list_context
	assert "Rating: 5/5" in list_context
	assert "curiosity angle" in list_context
	assert "user_id" not in list_context
	assert "storage_key" not in list_context


def test_knowledge_list_intent_is_owner_scoped(client, monkeypatch):
	import app.main as main_module

	owner = client.post("/api/auth/register", json={"email": "list-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": owner.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Owner Material", "content": "owner-only knowledge"})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	other = client.post("/api/auth/register", json={"email": "list-other@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": other.json()["csrfToken"]})

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	install_structured_intents(monkeypatch, main_module, lambda prompt: {
		"action": "knowledge_search", "knowledge_intent": "list", "knowledge_query": prompt,
	})
	conversation_id = client.post("/api/conversations", json={"title": "Изоляция списка"}).json()["conversation"]["id"]
	client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "Что находится в моей базе знаний?"})
	context = completions.calls[0]["messages"][-1]["content"]
	assert "Status: KNOWLEDGE_EMPTY" in context
	assert "Owner Material" not in context
	assert "owner-only knowledge" not in context


def test_three_active_items_retrieval_browse_toggle_and_sources(authenticated_client, monkeypatch):
	import app.main as main_module

	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	browse_prompts = {"что ты видишь в бд?", "напиши про все доступные тебе данные", "там три ячейки есть с данными"}
	install_structured_intents(monkeypatch, main_module, lambda prompt: {
		"action": "knowledge_search", "knowledge_intent": "list" if prompt in browse_prompts else "search", "knowledge_query": prompt,
	})
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
	assert "Title: Facebook Hooks" in search_context
	assert "Rating: 1/5" in search_context
	assert "Italy Advertorial" not in search_context
	assert "user_id" not in search_context
	assert "storage_key" not in search_context
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	sources = conversation["messages"][-1]["knowledgeSources"]
	assert sources == [{
		"id": created[0]["id"], "title": "Facebook Hooks", "sourceType": "manual", "rating": 1, "approach": None, "filters": [],
	}]

	for prompt in ("что ты видишь в бд?", "напиши про все доступные тебе данные", "там три ячейки есть с данными"):
		authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream",
			data={"prompt": prompt, "search_mode": "knowledge"},
		)
		browse_context = completions.calls[-1]["messages"][-1]["content"]
		assert "Mode: list" in browse_context
		assert "Active items: 3" in browse_context
		assert all(f"Title: {item['title']}" in browse_context for item in created)

	authenticated_client.patch(f"/api/knowledge/{created[0]['id']}", json={"is_active": False})
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Facebook curiosity", "search_mode": "knowledge"},
	)
	inactive_context = completions.calls[-1]["messages"][-1]["content"]
	assert "Active items: 2" in inactive_context
	assert "Status: NO_RELEVANT_TEXT_MATCH" in inactive_context
	assert "Facebook Hooks" not in inactive_context

	authenticated_client.patch(f"/api/knowledge/{created[0]['id']}", json={"is_active": True})
	authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Facebook curiosity", "search_mode": "knowledge"},
	)
	assert "Title: Facebook Hooks" in completions.calls[-1]["messages"][-1]["content"]


def test_lower_rating_keeps_saved_knowledge_active(authenticated_client, monkeypatch):
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
	assert items[0]["rating"] == 2


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
	assert preserved.json()["item"]["approach"] is None

	second = authenticated_client.post("/api/auth/register", json={
		"email": "approach-isolation@example.com", "password": "strong-password",
	})
	assert second.status_code == 200
	authenticated_client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	assert authenticated_client.get("/api/knowledge", params={"approach_id": foreign_approach_id}).status_code == 404
	assert authenticated_client.post("/api/knowledge", json={
		"title": "Чужой подход", "content": "Запрещено", "approach_id": foreign_approach_id,
	}).status_code == 404


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
	approach_filter = next(item for item in authenticated_client.get("/api/knowledge/filters").json()["items"] if item["name"] == "Подход")
	option_ids = {option["value"]: option["id"] for option in approach_filter["options"]}
	install_structured_intents(monkeypatch, main_module, lambda prompt: {
		"action": "knowledge_search",
		"knowledge_intent": "list" if prompt.startswith("Что") else "search",
		"knowledge_query": prompt,
		"filter_option_ids": [option_ids["Интервью"]] if "Интервью" in prompt else [option_ids["Шоу"]] if "Шоу" in prompt else [option_ids["Документалистика"]] if "Документалистика" in prompt else [],
		"unresolved_filters": [{"filterName": "Подход", "value": "Несуществующий"}] if "Несуществующий" in prompt else [],
	})
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Подходы"}).json()["conversation"]["id"]

	auto = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Как лучше начать текст для подхода Интервью?", "search_mode": "none"},
	)
	assert auto.status_code == 200
	context = completions.calls[-1]["messages"][-1]["content"]
	assert "Filter: Подход = Интервью" in context
	assert "Title: Начало интервью" in context
	assert "Начало шоу" not in context

	browse = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Что у меня есть по Шоу?", "search_mode": "none"},
	)
	assert browse.status_code == 200
	context = completions.calls[-1]["messages"][-1]["content"]
	assert "Mode: list" in context
	assert "Filter: Подход = Шоу" in context
	assert "Title: Начало шоу" in context
	assert "Начало интервью" not in context

	unknown = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Что есть для подхода Несуществующий?", "search_mode": "none"},
	)
	assert unknown.status_code == 200
	assert "Status: FILTER_VALUE_NOT_FOUND" in completions.calls[-1]["messages"][-1]["content"]
	empty_response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": f"Что есть по {empty['name']}?", "search_mode": "none"},
	)
	assert empty_response.status_code == 200
	assert "Status: FILTER_HAS_NO_ITEMS" in completions.calls[-1]["messages"][-1]["content"]


def test_manual_knowledge_is_markdown_without_title_duplication(authenticated_client):
	content = "**1. Тихий вечер**\n\nОсновной текст."
	created = authenticated_client.post("/api/knowledge", json={
		"title": "Тихий вечер", "content": content,
	})
	assert created.status_code == 200
	item = created.json()["item"]
	assert item["title"] == "Тихий вечер"
	assert item["content"] == content
	assert item["mimeType"] == "text/markdown"
	assert item["originalFilename"].endswith(".md")
	assert not item["content"].startswith("# Тихий вечер")
	reloaded = authenticated_client.get(f"/api/knowledge/{item['id']}").json()["item"]
	assert reloaded["content"] == content
	updated_content = "\n# Вступление\n\nТекст с пользовательским заголовком.\n"
	updated = authenticated_client.patch(f"/api/knowledge/{item['id']}", json={
		"title": "Новый тихий вечер", "content": updated_content,
	}).json()["item"]
	assert updated["content"] == updated_content
	assert updated["originalFilename"] != item["originalFilename"]
	assert updated["originalFilename"].endswith(f"-{item['id'][:8]}.md")


def test_generated_file_can_be_linked_to_knowledge_with_metadata(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq(FixedCompletions(
		"```file:script.js\nconsole.log('Velorian');\n```\n\nФайл готов.",
	)))
	geo = authenticated_client.post("/api/knowledge/filters", json={"name": "ГЕО"}).json()["item"]
	brazil = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Бразилия"}).json()["item"]
	approach = next(item for item in authenticated_client.get("/api/knowledge/filters").json()["items"] if item["name"] == "Подход")
	interview = next(option for option in approach["options"] if option["value"] == "Интервью")
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Файл в знания"}).json()["conversation"]["id"]
	stream = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream", data={"prompt": "Создай файл script.js"},
	)
	done = next(json.loads(line) for line in stream.text.splitlines() if '"type": "done"' in line)
	attachment = done["message"]["attachments"][0]

	created = authenticated_client.post(f"/api/knowledge/generated-files/{attachment['id']}", json={
		"title": "Скрипт Velorian", "rating": 5, "is_active": True,
		"filter_option_ids": [interview["id"], brazil["id"]],
	})
	assert created.status_code == 200
	item = created.json()["item"]
	assert item["sourceType"] == "assistant_generated_file"
	assert item["sourceFileId"] == attachment["id"]
	assert item["sourceMessageId"] == done["message"]["id"]
	assert item["content"] == "console.log('Velorian');"
	assert {(value["filterName"], value["value"]) for value in item["filters"]} == {
		("Подход", "Интервью"), ("ГЕО", "Бразилия"),
	}
	assert authenticated_client.get(item["downloadUrl"]).content == b"console.log('Velorian');"
	duplicate = authenticated_client.post(f"/api/knowledge/generated-files/{attachment['id']}", json={
		"title": "Повтор", "filter_option_ids": [],
	})
	assert duplicate.status_code == 409
	assert duplicate.json()["error"]["code"] == "KNOWLEDGE_FILE_ALREADY_ADDED"
	second = authenticated_client.post("/api/auth/register", json={
		"email": "generated-file-isolation@example.com", "password": "strong-password",
	})
	authenticated_client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	assert authenticated_client.post(f"/api/knowledge/generated-files/{attachment['id']}", json={
		"title": "Чужой файл", "filter_option_ids": [],
	}).status_code == 404


def test_dynamic_metadata_filters_use_and_semantics_and_enforce_ownership(authenticated_client, monkeypatch):
	geo = authenticated_client.post("/api/knowledge/filters", json={"name": "ГЕО"}).json()["item"]
	brazil = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Бразилия"}).json()["item"]
	italy = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Италия"}).json()["item"]
	approach = next(item for item in authenticated_client.get("/api/knowledge/filters").json()["items"] if item["name"] == "Подход")
	interview = next(option for option in approach["options"] if option["value"] == "Интервью")
	show = next(option for option in approach["options"] if option["value"] == "Шоу")
	item_a = authenticated_client.post("/api/knowledge", json={
		"title": "A", "content": "Бразильское интервью", "filter_option_ids": [brazil["id"], interview["id"]],
	}).json()["item"]
	authenticated_client.post("/api/knowledge", json={
		"title": "B", "content": "Итальянское шоу", "filter_option_ids": [italy["id"], show["id"]],
	})
	filtered = authenticated_client.get("/api/knowledge", params=[
		("filter_option_id", brazil["id"]), ("filter_option_id", interview["id"]),
	])
	assert [item["id"] for item in filtered.json()["items"]] == [item_a["id"]]
	import app.main as main_module
	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	install_structured_intents(monkeypatch, main_module, lambda prompt: {
		"action": "knowledge_search", "knowledge_intent": "search", "knowledge_query": "материалы",
		"filter_option_ids": [brazil["id"], interview["id"]],
	})
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "AND metadata"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={
		"prompt": "дай материалы для Бразилии по интервью",
	})
	context = completions.calls[-1]["messages"][-1]["content"]
	assert "Title: A" in context
	assert "Title: B" not in context

	offer = authenticated_client.post("/api/knowledge/filters", json={"name": "Оффер"}).json()["item"]
	alpha = authenticated_client.post(f"/api/knowledge/filters/{offer['id']}/options", json={"value": "Alpha"}).json()["item"]
	renamed_offer = authenticated_client.patch(f"/api/knowledge/filters/{offer['id']}", json={"name": "Продукт"})
	assert renamed_offer.status_code == 200
	assert renamed_offer.json()["item"]["name"] == "Продукт"
	renamed_alpha = authenticated_client.patch(f"/api/knowledge/filters/{offer['id']}/options/{alpha['id']}", json={"value": "Beta"})
	assert renamed_alpha.status_code == 200
	assert renamed_alpha.json()["item"]["value"] == "Beta"
	assert authenticated_client.delete(f"/api/knowledge/filters/{offer['id']}/options/{alpha['id']}").status_code == 204
	assert authenticated_client.delete(f"/api/knowledge/filters/{offer['id']}").status_code == 204

	second = authenticated_client.post("/api/auth/register", json={
		"email": "filter-isolation@example.com", "password": "strong-password",
	})
	authenticated_client.headers.update({"X-CSRF-Token": second.json()["csrfToken"]})
	foreign = authenticated_client.post("/api/knowledge", json={
		"title": "Чужой option", "content": "Запрещено", "filter_option_ids": [brazil["id"]],
	})
	assert foreign.status_code == 422
	assert foreign.json()["error"]["code"] == "INVALID_FILTER_OPTION"
	assert authenticated_client.patch(f"/api/knowledge/filters/{geo['id']}", json={"name": "Чужой"}).status_code == 404
	assert authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Франция"}).status_code == 404
	assert authenticated_client.delete(f"/api/knowledge/filters/{geo['id']}/options/{brazil['id']}").status_code == 404


def test_filter_and_option_rename_preserve_ids_links_counts_and_block_normalized_duplicates(authenticated_client):
	geo = authenticated_client.post("/api/knowledge/filters", json={"name": "ГЕО"}).json()["item"]
	brazil = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Brasil"}).json()["item"]
	mexico = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Mexico"}).json()["item"]
	item_ids = [
		authenticated_client.post("/api/knowledge", json={
			"title": f"Материал {index}", "content": "Контент",
			"filters": [{"filter_id": geo["id"], "option_ids": [brazil["id"]]}],
		}).json()["item"]["id"]
		for index in range(5)
	]
	schema = authenticated_client.get("/api/knowledge/filters").json()["items"]
	geo_schema = next(item for item in schema if item["id"] == geo["id"])
	assert geo_schema["itemCount"] == 5
	assert next(option for option in geo_schema["options"] if option["id"] == brazil["id"])["itemCount"] == 5

	renamed = authenticated_client.patch(f"/api/knowledge/filters/{geo['id']}", json={"name": "  Страна  "}).json()["item"]
	assert renamed["id"] == geo["id"]
	assert renamed["slug"] == geo["slug"]
	assert renamed["name"] == "Страна"
	from app.agent_intent import available_filter_catalog
	from app.database import SessionLocal
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		assert next(definition for definition in available_filter_catalog(db, user_id) if definition["id"] == geo["id"])["name"] == "Страна"
	for item_id in item_ids:
		item = authenticated_client.get(f"/api/knowledge/{item_id}").json()["item"]
		assert len(item["filters"]) == 1
		assert item["filters"][0]["filterId"] == geo["id"]
		assert item["filters"][0]["filterName"] == "Страна"

	renamed_option = authenticated_client.patch(
		f"/api/knowledge/filters/{geo['id']}/options/{brazil['id']}", json={"value": "  БРАЗИЛИЯ  "},
	).json()["item"]
	assert renamed_option["id"] == brazil["id"]
	assert renamed_option["value"] == "БРАЗИЛИЯ"
	assert renamed_option["normalizedValue"] == "бразилия"
	alias = authenticated_client.post(
		f"/api/knowledge/filters/{geo['id']}/options/{brazil['id']}/aliases", json={"value": "Brazil"},
	)
	assert alias.status_code == 200
	with SessionLocal() as db:
		catalog_option = next(
			option
			for definition in available_filter_catalog(db, user_id) if definition["id"] == geo["id"]
			for option in definition["options"] if option["id"] == brazil["id"]
		)
	assert catalog_option["value"] == "БРАЗИЛИЯ"
	assert catalog_option["aliases"] == ["Brazil"]
	assert all(
		authenticated_client.get(f"/api/knowledge/{item_id}").json()["item"]["filters"][0]["value"] == "БРАЗИЛИЯ"
		for item_id in item_ids
	)

	duplicate_option = authenticated_client.patch(
		f"/api/knowledge/filters/{geo['id']}/options/{mexico['id']}", json={"value": "  бразилия "},
	)
	assert duplicate_option.status_code == 409
	assert duplicate_option.json()["error"]["code"] == "FILTER_OPTION_ALREADY_EXISTS"
	geo_after_duplicate = next(definition for definition in authenticated_client.get("/api/knowledge/filters").json()["items"] if definition["id"] == geo["id"])
	assert next(option for option in geo_after_duplicate["options"] if option["id"] == mexico["id"])["value"] == "Mexico"

	offer = authenticated_client.post("/api/knowledge/filters", json={"name": "Оффер"}).json()["item"]
	duplicate_filter = authenticated_client.patch(f"/api/knowledge/filters/{offer['id']}", json={"name": " страна "})
	assert duplicate_filter.status_code == 409
	assert duplicate_filter.json()["error"]["code"] == "FILTER_ALREADY_EXISTS"
	assert authenticated_client.get("/api/knowledge/filters").status_code == 200

	assert authenticated_client.delete(f"/api/knowledge/filters/{geo['id']}/options/{brazil['id']}").status_code == 204
	assert all(authenticated_client.get(f"/api/knowledge/{item_id}").status_code == 200 for item_id in item_ids)
	assert all(authenticated_client.get(f"/api/knowledge/{item_id}").json()["item"]["filters"] == [] for item_id in item_ids)
	assert authenticated_client.delete(f"/api/knowledge/filters/{geo['id']}").status_code == 204
	assert all(authenticated_client.get(f"/api/knowledge/{item_id}").status_code == 200 for item_id in item_ids)
	system_filter = next(item for item in authenticated_client.get("/api/knowledge/filters").json()["items"] if item["isSystem"])
	system_delete = authenticated_client.delete(f"/api/knowledge/filters/{system_filter['id']}")
	assert system_delete.status_code == 422
	assert system_delete.json()["error"]["code"] == "SYSTEM_FILTER_CANNOT_BE_DELETED"


def test_multiselect_filter_groups_use_or_inside_and_between_and_validate_pairs(authenticated_client, monkeypatch):
	geo = authenticated_client.post("/api/knowledge/filters", json={"name": "ГЕО"}).json()["item"]
	brazil = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Brazil"}).json()["item"]
	mexico = authenticated_client.post(f"/api/knowledge/filters/{geo['id']}/options", json={"value": "Mexico"}).json()["item"]
	offer = authenticated_client.post("/api/knowledge/filters", json={"name": "Оффер"}).json()["item"]
	xp = authenticated_client.post(f"/api/knowledge/filters/{offer['id']}/options", json={"value": "XP"}).json()["item"]
	magalu = authenticated_client.post(f"/api/knowledge/filters/{offer['id']}/options", json={"value": "Magalu"}).json()["item"]
	approach = next(item for item in authenticated_client.get("/api/knowledge/filters").json()["items"] if item["isSystem"])
	interview = next(option for option in approach["options"] if option["value"] == "Интервью")
	show = next(option for option in approach["options"] if option["value"] == "Шоу")

	def create(title, selections):
		return authenticated_client.post("/api/knowledge", json={
			"title": title, "content": title,
			"filters": [{"filter_id": filter_id, "option_ids": option_ids} for filter_id, option_ids in selections],
		}).json()["item"]

	item_a = create("Brazil XP Interview", [(geo["id"], [brazil["id"]]), (offer["id"], [xp["id"]]), (approach["id"], [interview["id"]])])
	item_b = create("Mexico XP Interview", [(geo["id"], [mexico["id"]]), (offer["id"], [xp["id"]]), (approach["id"], [interview["id"]])])
	item_c = create("Brazil Magalu Show", [(geo["id"], [brazil["id"]]), (offer["id"], [magalu["id"]]), (approach["id"], [show["id"]])])
	item_d = create("Dual geo XP Interview", [(geo["id"], [brazil["id"], mexico["id"]]), (offer["id"], [xp["id"]]), (approach["id"], [interview["id"]])])

	def filtered(groups):
		response = authenticated_client.get("/api/knowledge", params={
			"filters": json.dumps([{"filter_id": filter_id, "option_ids": option_ids} for filter_id, option_ids in groups]),
		})
		assert response.status_code == 200
		return {item["id"] for item in response.json()["items"]}

	assert filtered([(geo["id"], [brazil["id"]])]) == {item_a["id"], item_c["id"], item_d["id"]}
	assert filtered([(geo["id"], [brazil["id"], mexico["id"]])]) == {item_a["id"], item_b["id"], item_c["id"], item_d["id"]}
	assert filtered([(geo["id"], [brazil["id"], mexico["id"]]), (offer["id"], [xp["id"]])]) == {item_a["id"], item_b["id"], item_d["id"]}
	assert filtered([(geo["id"], [brazil["id"], mexico["id"]]), (offer["id"], [xp["id"]]), (approach["id"], [interview["id"]])]) == {item_a["id"], item_b["id"], item_d["id"]}
	assert filtered([(geo["id"], [brazil["id"]]), (geo["id"], [mexico["id"]])]) == {item_a["id"], item_b["id"], item_c["id"], item_d["id"]}

	invalid = authenticated_client.get("/api/knowledge", params={
		"filters": json.dumps([{"filter_id": geo["id"], "option_ids": [xp["id"]]}]),
	})
	assert invalid.status_code == 422
	assert invalid.json()["error"]["code"] == "INVALID_FILTER_OPTION"

	updated = authenticated_client.patch(f"/api/knowledge/{item_d['id']}", json={
		"filters": [{"filter_id": geo["id"], "option_ids": [brazil["id"], mexico["id"], brazil["id"]]}],
	})
	assert updated.status_code == 200
	assert {value["optionId"] for value in updated.json()["item"]["filters"]} == {brazil["id"], mexico["id"]}

	import app.main as main_module
	completions = RecordingCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	install_structured_intents(monkeypatch, main_module, lambda _prompt: {
		"action": "knowledge_search", "knowledge_intent": "search", "knowledge_query": "",
		"filters": [
			{"filterId": geo["id"], "optionIds": [mexico["id"]], "status": "resolved", "confidence": 1, "explicit": True},
			{"filterId": offer["id"], "optionIds": [magalu["id"]], "status": "resolved", "confidence": 1, "explicit": True},
		],
	})
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Пустая комбинация"}).json()["conversation"]["id"]
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "только Mexico и только Magalu"})
	assert "Status: FILTER_COMBINATION_EMPTY" in completions.calls[-1]["messages"][-1]["content"]
	install_structured_intents(monkeypatch, main_module, lambda _prompt: {
		"action": "knowledge_search", "knowledge_intent": "search", "knowledge_query": "show",
		"ambiguous_filters": [{"filterName": "Подход / Оффер", "value": "Show"}],
	})
	authenticated_client.post(f"/api/conversations/{conversation_id}/stream", data={"prompt": "покажи show материалы"})
	assert "Status: AMBIGUOUS_FILTER" in completions.calls[-1]["messages"][-1]["content"]


def test_csrf_rejects_missing_invalid_and_rotated_tokens(client):
	valid = client.headers.pop("X-CSRF-Token")
	missing = client.post("/api/conversations", json={"title": "Нет токена"})
	assert missing.status_code == 403
	assert missing.json()["error"]["code"] == "CSRF_INVALID"
	client.headers.update({"X-CSRF-Token": "invalid"})
	assert client.post("/api/conversations", json={"title": "Плохой токен"}).status_code == 403
	client.headers.update({"X-CSRF-Token": valid})
	registered = client.post("/api/auth/register", json={"email": "csrf@example.com", "password": "strong-password"})
	assert registered.status_code == 200
	rotated = registered.json()["csrfToken"]
	assert rotated != valid
	assert client.post("/api/conversations", json={"title": "Старый токен"}).status_code == 403
	client.headers.update({"X-CSRF-Token": rotated})
	assert client.post("/api/conversations", json={"title": "Новый токен"}).status_code == 200
