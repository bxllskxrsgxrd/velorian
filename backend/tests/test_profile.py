from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from app.auth import COOKIE_NAME, create_session_token, hash_password
from app.database import SessionLocal
from app.models import AIUsageEvent, ActivityEvent, Conversation, User, utc_now
from app.roles import UserRole


def _create_identity(prefix: str, role: UserRole = UserRole.USER) -> tuple[str, str]:
	marker = uuid4().hex[:10]
	with SessionLocal() as db:
		user = User(
			login=f"{prefix}-{marker}",
			email=f"{prefix}-{marker}@example.com",
			password_hash=hash_password("strong-password"),
			role=role,
		)
		db.add(user)
		db.flush()
		conversation = Conversation(user_id=user.id, title="Profile analytics")
		db.add(conversation)
		db.commit()
		return user.id, conversation.id


def _set_session(client, user_id: str) -> None:
	client.cookies.set(COOKIE_NAME, create_session_token(user_id))


def _usage_event(
	*,
	user_id: str,
	conversation_id: str,
	purpose: str,
	provider: str,
	model: str,
	status: str,
	created_at,
	input_tokens: int | None,
	output_tokens: int | None,
	cached_tokens: int | None,
	cost: Decimal | None,
	id: str | None = None,
) -> AIUsageEvent:
	return AIUsageEvent(
		id=id or str(uuid4()),
		user_id=user_id,
		conversation_id=conversation_id,
		correlation_id=f"profile-{uuid4()}",
		purpose=purpose,
		task_type=purpose,
		provider=provider,
		model=model,
		prompt_version=f"{purpose}:test",
		reasoning_effort=None,
		status=status,
		input_tokens=input_tokens,
		output_tokens=output_tokens,
		cached_tokens=cached_tokens,
		total_tokens=(input_tokens + output_tokens) if input_tokens is not None and output_tokens is not None else None,
		latency_ms=125.5,
		estimated_cost_usd=cost,
		created_at=created_at,
	)


def test_profile_endpoints_require_authentication(client):
	for path in (
		"/api/profile/usage",
		"/api/profile/usage/events",
		"/api/profile/activity",
		"/api/profile/security",
	):
		assert client.get(path).status_code == 401


def test_profile_usage_aggregates_periods_nulls_and_isolates_users(client):
	user_id, conversation_id = _create_identity("profile-usage")
	other_user_id, other_conversation_id = _create_identity("profile-other", UserRole.ADMIN)
	now = utc_now()
	with SessionLocal() as db:
		db.add_all([
			_usage_event(
				user_id=user_id, conversation_id=conversation_id, purpose="chat", provider="groq", model="model-a",
				status="success", created_at=now - timedelta(days=1), input_tokens=100, output_tokens=50,
				cached_tokens=10, cost=Decimal("0.0125"),
			),
			_usage_event(
				user_id=user_id, conversation_id=conversation_id, purpose="title", provider="groq", model="model-a",
				status="error", created_at=now - timedelta(days=2), input_tokens=None, output_tokens=None,
				cached_tokens=None, cost=None,
			),
			_usage_event(
				user_id=user_id, conversation_id=conversation_id, purpose="branch_summary", provider="gemini", model="model-b",
				status="cancelled", created_at=now - timedelta(days=3), input_tokens=15, output_tokens=5,
				cached_tokens=0, cost=Decimal("0.001"),
			),
			_usage_event(
				user_id=user_id, conversation_id=conversation_id, purpose="chat", provider="groq", model="old-model",
				status="success", created_at=now - timedelta(days=100), input_tokens=900, output_tokens=99,
				cached_tokens=0, cost=Decimal("9"),
			),
			_usage_event(
				user_id=other_user_id, conversation_id=other_conversation_id, purpose="vision", provider="groq", model="private-model",
				status="success", created_at=now, input_tokens=5000, output_tokens=5000,
				cached_tokens=0, cost=Decimal("50"),
			),
		])
		db.commit()

	_set_session(client, user_id)
	response = client.get("/api/profile/usage", params={"period": "30d", "user_id": other_user_id})
	assert response.status_code == 200
	payload = response.json()
	assert payload["totals"] == {
		"requestCount": 3,
		"successCount": 1,
		"errorCount": 1,
		"cancelledCount": 1,
		"inputTokens": 115,
		"outputTokens": 55,
		"cachedTokens": 10,
		"totalTokens": 170,
		"knownCostUsd": "0.01350000",
		"unknownCostCount": 1,
		"unknownTokenCount": 1,
	}
	assert {(item["provider"], item["model"], item["requestCount"]) for item in payload["models"]} == {
		("groq", "model-a", 2),
		("gemini", "model-b", 1),
	}
	assert {item["purpose"] for item in payload["purposes"]} == {"chat", "title", "branch_summary"}
	assert client.get("/api/profile/usage", params={"period": "all"}).json()["totals"]["requestCount"] == 4
	assert "private-model" not in str(payload)

	_set_session(client, other_user_id)
	admin_payload = client.get("/api/profile/usage", params={"period": "all", "user_id": user_id}).json()
	assert admin_payload["totals"]["requestCount"] == 1
	assert admin_payload["models"][0]["model"] == "private-model"
	assert "model-a" not in str(admin_payload)


def test_profile_usage_history_filters_paginates_and_sorts_stably(client):
	user_id, conversation_id = _create_identity("profile-history")
	other_user_id, other_conversation_id = _create_identity("profile-history-other")
	now = utc_now()
	with SessionLocal() as db:
		db.add_all([
			_usage_event(
				id="00000000-0000-0000-0000-000000000001", user_id=user_id, conversation_id=conversation_id,
				purpose="chat", provider="groq", model="model-a", status="success", created_at=now,
				input_tokens=10, output_tokens=5, cached_tokens=0, cost=Decimal("0.1"),
			),
			_usage_event(
				id="00000000-0000-0000-0000-000000000002", user_id=user_id, conversation_id=conversation_id,
				purpose="chat", provider="groq", model="model-a", status="success", created_at=now,
				input_tokens=20, output_tokens=5, cached_tokens=0, cost=None,
			),
			_usage_event(
				id="00000000-0000-0000-0000-000000000003", user_id=user_id, conversation_id=conversation_id,
				purpose="title", provider="groq", model="model-a", status="error", created_at=now - timedelta(hours=1),
				input_tokens=None, output_tokens=None, cached_tokens=None, cost=None,
			),
			_usage_event(
				user_id=other_user_id, conversation_id=other_conversation_id, purpose="chat", provider="groq",
				model="foreign", status="success", created_at=now, input_tokens=1, output_tokens=1,
				cached_tokens=0, cost=Decimal("1"),
			),
		])
		db.commit()

	_set_session(client, user_id)
	first = client.get("/api/profile/usage/events", params={
		"period": "7d", "page": 1, "pageSize": 1, "model": "model-a", "purpose": "chat", "status": "success",
	}).json()
	second = client.get("/api/profile/usage/events", params={
		"period": "7d", "page": 2, "pageSize": 1, "model": "model-a", "purpose": "chat", "status": "success",
	}).json()
	assert (first["total"], first["totalPages"]) == (2, 2)
	assert [first["events"][0]["id"], second["events"][0]["id"]] == [
		"00000000-0000-0000-0000-000000000002",
		"00000000-0000-0000-0000-000000000001",
	]
	assert first["events"][0]["estimatedCostUsd"] is None
	assert first["events"][0]["totalTokens"] == 25
	assert "foreign" not in str(first)


def test_profile_activity_and_security_are_scoped_to_current_user(client):
	user_id, _conversation_id = _create_identity("profile-activity")
	other_user_id, _other_conversation_id = _create_identity("profile-activity-other")
	now = utc_now()
	with SessionLocal() as db:
		db.add_all([
			ActivityEvent(
				id="00000000-0000-0000-0000-000000000011", user_id=user_id, event_type="auth.login",
				resource_type="user", resource_id=user_id, status="success", created_at=now - timedelta(hours=2),
			),
			ActivityEvent(
				id="00000000-0000-0000-0000-000000000012", user_id=user_id, event_type="conversation.created",
				resource_type="conversation", resource_id="own-chat", status="success", created_at=now - timedelta(hours=1),
			),
			ActivityEvent(
				id="00000000-0000-0000-0000-000000000013", user_id=user_id, event_type="auth.logout",
				resource_type="user", resource_id=user_id, status="success", created_at=now,
			),
			ActivityEvent(
				user_id=other_user_id, event_type="conversation.created", resource_type="conversation",
				resource_id="foreign-chat", status="success", created_at=now,
			),
		])
		db.commit()

	_set_session(client, user_id)
	activity = client.get("/api/profile/activity", params={"period": "7d", "pageSize": 2}).json()
	assert activity["total"] == 3
	assert [event["id"] for event in activity["events"]] == [
		"00000000-0000-0000-0000-000000000013",
		"00000000-0000-0000-0000-000000000012",
	]
	filtered = client.get("/api/profile/activity", params={"eventType": "conversation.created"}).json()
	assert filtered["total"] == 1
	assert filtered["events"][0]["resourceType"] == "conversation"
	assert "foreign-chat" not in str(activity)

	security = client.get("/api/profile/security").json()
	assert security["account"]["id"] == user_id
	assert security["account"]["role"] == "user"
	assert security["lastSuccessfulLoginAt"] is not None
	assert [event["eventType"] for event in security["authEvents"]] == ["auth.logout", "auth.login"]

	_set_session(client, other_user_id)
	other_security = client.get("/api/profile/security").json()
	assert other_security["account"]["id"] == other_user_id
	assert other_security["lastSuccessfulLoginAt"] is None
	assert other_security["authEvents"] == []
