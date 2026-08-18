from types import SimpleNamespace


class FakeCompletions:
	async def create(self, **kwargs):
		async def chunks():
			for content in ("Привет", ", мир!"):
				yield SimpleNamespace(
					choices=[SimpleNamespace(delta=SimpleNamespace(content=content))],
				)
		return chunks()


class FakeGroq:
	def __init__(self):
		self.chat = SimpleNamespace(completions=FakeCompletions())


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
	assert client.get("/api/auth/me").status_code == 200

	client.post("/api/auth/logout")
	assert client.get("/api/auth/me").status_code == 401
	assert client.post(
		"/api/auth/login",
		json={"email": "first@example.com", "password": "strong-password"},
	).status_code == 200

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


def test_streaming_and_retry(authenticated_client, monkeypatch):
	import app.main as main_module

	monkeypatch.setattr(main_module, "client", FakeGroq())
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Новый диалог"}).json()["conversation"]["id"]

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


def test_rejects_unsupported_file(authenticated_client):
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Файлы"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверь"},
		files={"files": ("archive.zip", b"content", "application/zip")},
	)
	assert response.status_code == 415
	assert response.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"


def test_rejects_broken_supported_file(authenticated_client):
	conversation_id = authenticated_client.post("/api/conversations", json={"title": "Файлы"}).json()["conversation"]["id"]
	response = authenticated_client.post(
		f"/api/conversations/{conversation_id}/stream",
		data={"prompt": "Проверь"},
		files={"files": ("broken.pdf", b"not a pdf", "application/pdf")},
	)
	assert response.status_code == 422
	assert response.json()["error"]["code"] == "FILE_PROCESSING_FAILED"
