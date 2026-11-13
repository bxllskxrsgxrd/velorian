import json
from types import SimpleNamespace

from app.database import SessionLocal
from app.memory import read_user_memory


EMPTY_PATCH = {"project": {}, "preferences": {}, "decisions": []}


class MemoryExtractionCompletions:
	def __init__(self, patches: dict[str, dict] | None = None, failing_messages: set[str] | None = None):
		self.patches = patches or {}
		self.failing_messages = failing_messages or set()
		self.extraction_calls: list[dict] = []

	async def create(self, **kwargs):
		if kwargs.get("stream", False):
			async def chunks():
				yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="Готово"))])
			return chunks()
		if "response_format" not in kwargs:
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])
		self.extraction_calls.append(kwargs)
		user_message = kwargs["messages"][1]["content"]
		if user_message in self.failing_messages:
			raise RuntimeError("memory provider failed")
		return SimpleNamespace(
			choices=[SimpleNamespace(message=SimpleNamespace(
				content=json.dumps(self.patches.get(user_message, EMPTY_PATCH), ensure_ascii=False),
			))],
			usage=SimpleNamespace(prompt_tokens=20, completion_tokens=5),
		)


class FakeGroq:
	def __init__(self, completions):
		self.chat = SimpleNamespace(completions=completions)


def test_memory_extraction_persists_project_preference_and_unique_decision(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	project_message = "Проект использует PostgreSQL как основную базу данных"
	preference_message = "Я всегда предпочитаю краткие ответы"
	decision_message = "Решили не добавлять Redux в проект"
	patches = {
		project_message: {"project": {"database": "PostgreSQL"}, "preferences": {}, "decisions": []},
		preference_message: {"project": {}, "preferences": {"response_style": "краткие ответы"}, "decisions": []},
		decision_message: {"project": {}, "preferences": {}, "decisions": ["Не добавлять Redux в проект"]},
	}
	completions = MemoryExtractionCompletions(patches)
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Memory extraction"},
	).json()["conversation"]["id"]

	with caplog.at_level("INFO", logger="uvicorn.error"):
		for message in (project_message, preference_message, decision_message, decision_message):
			response = authenticated_client.post(
				f"/api/conversations/{conversation_id}/stream", data={"prompt": message},
			)
			assert response.status_code == 200
			assert '"type": "done"' in response.text

	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		assert read_user_memory(db, user_id) == {
			"project": {"database": "PostgreSQL"},
			"preferences": {"response_style": "краткие ответы"},
			"decisions": ["Не добавлять Redux в проект"],
		}
	usage_logs = [record.getMessage() for record in caplog.records if "purpose=memory_extraction" in record.getMessage()]
	assert len(usage_logs) == 4
	assert all(
		"task_type=memory" in log
		and "prompt_version=memory_extraction:v1" in log
		and "reasoning_effort=low" in log
		for log in usage_logs
	)


def test_memory_extraction_gate_controls_ai_calls_and_uses_only_current_message(
	authenticated_client,
	monkeypatch,
	caplog,
):
	import app.main as main_module

	skipped_messages = (
		"ок",
		"спасибо",
		"давай",
		"продолжай",
		"понял",
		"Как работает замыкание в Python?",
		"Запомни branch-local RED-333",
		"Запомни branch-local BLUE-666",
	)
	extracted_messages = (
		"Мы решили использовать PostgreSQL",
		"Всегда отвечай мне коротко",
		"Проект теперь называется Velorian",
	)
	completions = MemoryExtractionCompletions()
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Memory exclusions"},
	).json()["conversation"]["id"]
	with caplog.at_level("INFO", logger="uvicorn.error"):
		for message in skipped_messages:
			response = authenticated_client.post(
				f"/api/conversations/{conversation_id}/stream", data={"prompt": message},
			)
			assert response.status_code == 200

		assert completions.extraction_calls == []
		assert not any("purpose=memory_extraction" in record.getMessage() for record in caplog.records)

		for expected_call_count, message in enumerate(extracted_messages, start=1):
			response = authenticated_client.post(
				f"/api/conversations/{conversation_id}/stream", data={"prompt": message},
			)
			assert response.status_code == 200
			assert len(completions.extraction_calls) == expected_call_count

	assert len(completions.extraction_calls) == len(extracted_messages)
	for call, current_message in zip(completions.extraction_calls, extracted_messages, strict=True):
		assert call["messages"] == [
			{"role": "system", "content": main_module.MEMORY_EXTRACTION_PROMPT},
			{"role": "user", "content": current_message},
		]
		assert call["response_format"] == {"type": "json_object"}
		assert main_module.CHAT_PROMPT not in json.dumps(call["messages"], ensure_ascii=False)
	usage_logs = [record.getMessage() for record in caplog.records if "purpose=memory_extraction" in record.getMessage()]
	assert len(usage_logs) == len(extracted_messages)

	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		assert read_user_memory(db, user_id) == EMPTY_PATCH


def test_memory_extraction_failure_does_not_break_successful_chat(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	message = "Сохрани устойчивое решение"
	completions = MemoryExtractionCompletions(failing_messages={message})
	monkeypatch.setattr(main_module, "client", FakeGroq(completions))
	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Memory failure"},
	).json()["conversation"]["id"]
	with caplog.at_level("WARNING", logger="velorian"):
		response = authenticated_client.post(
			f"/api/conversations/{conversation_id}/stream", data={"prompt": message},
		)

	assert response.status_code == 200
	assert '"type": "done"' in response.text
	conversation = authenticated_client.get(f"/api/conversations/{conversation_id}").json()["conversation"]
	assert conversation["messages"][-1]["role"] == "assistant"
	assert conversation["messages"][-1]["status"] == "done"
	assert any("Memory extraction failed" in record.getMessage() for record in caplog.records)
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		assert read_user_memory(db, user_id) == EMPTY_PATCH
