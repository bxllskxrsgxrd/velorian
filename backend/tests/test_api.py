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
	assert columns["is_active"]["nullable"] is False
	index_names = {index["name"] for index in inspector.get_indexes("knowledge_items")}
	assert {
		"ix_knowledge_user_active",
		"ix_knowledge_user_source",
		"ix_knowledge_user_rating",
		"ix_knowledge_user_created",
		"ix_knowledge_user_updated",
	}.issubset(index_names)
	foreign_keys = {fk["constrained_columns"][0]: fk for fk in inspector.get_foreign_keys("knowledge_items")}
	assert foreign_keys["user_id"]["options"]["ondelete"] == "CASCADE"
	assert foreign_keys["source_message_id"]["options"]["ondelete"] == "SET NULL"


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

	owner = client.post("/api/auth/register", json={"email": "list-owner@example.com", "password": "strong-password"})
	client.headers.update({"X-CSRF-Token": owner.json()["csrfToken"]})
	client.post("/api/knowledge", json={"title": "Owner Material", "content": "owner-only knowledge"})
	client.post("/api/auth/logout")
	client.headers.update({"X-CSRF-Token": client.get("/api/auth/csrf").json()["csrfToken"]})
	other = client.post("/api/auth/register", json={"email": "list-other@example.com", "password": "strong-password"})
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
		"id": created[0]["id"], "title": "Facebook Hooks", "sourceType": "manual", "rating": 1,
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
