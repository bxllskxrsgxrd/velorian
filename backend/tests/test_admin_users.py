from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app import admin_users
from app.auth import hash_password
from app.database import SessionLocal
from app.main import app
from app.models import RoleChangeAudit, User
from app.roles import UserRole


@pytest.fixture(autouse=True)
def release_owner_role():
	yield
	with SessionLocal() as db:
		db.execute(update(User).where(User.role == UserRole.OWNER).values(role=UserRole.USER))
		db.commit()


def _create_user(role: UserRole = UserRole.USER, *, prefix: str = "admin-api") -> dict[str, str]:
	identity = f"{prefix}-{uuid4().hex[:10]}"
	with SessionLocal() as db:
		user = User(
			login=identity,
			email=f"{identity}@example.com",
			password_hash=hash_password("strong-password"),
			role=role,
		)
		db.add(user)
		db.commit()
		return {"id": user.id, "login": user.login, "email": user.email}


def _login(client: TestClient, user: dict[str, str]) -> None:
	response = client.post("/api/auth/login", json={
		"identifier": user["login"],
		"password": "strong-password",
	})
	assert response.status_code == 200
	client.headers.update({"X-CSRF-Token": response.json()["csrfToken"]})


def test_admin_users_requires_authentication_and_admin_role(client):
	target = _create_user()
	assert client.get("/api/admin/users").status_code == 401
	assert client.patch(f"/api/admin/users/{target['id']}/role", json={"role": "admin"}).status_code == 401

	regular_user = _create_user()
	_login(client, regular_user)
	denied = client.get("/api/admin/users")
	assert denied.status_code == 403
	assert denied.json()["error"]["code"] == "INSUFFICIENT_ROLE"


def test_admin_can_search_and_paginate_but_cannot_change_roles(client):
	prefix = f"search-{uuid4().hex[:8]}"
	admin = _create_user(UserRole.ADMIN)
	created = [_create_user(prefix=prefix) for _ in range(3)]
	_login(client, admin)

	first = client.get("/api/admin/users", params={"search": prefix, "page": 1, "pageSize": 2})
	assert first.status_code == 200
	assert first.json()["total"] == 3
	assert first.json()["totalPages"] == 2
	assert len(first.json()["users"]) == 2
	second = client.get("/api/admin/users", params={"search": prefix, "page": 2, "pageSize": 2})
	assert len(second.json()["users"]) == 1
	listed = first.json()["users"] + second.json()["users"]
	assert {
		item["id"] for item in listed
	} == {item["id"] for item in created}
	assert [item["login"] for item in listed] == sorted(item["login"] for item in listed)
	assert all(set(item) == {"id", "login", "email", "role", "createdAt"} for item in listed)
	assert client.get("/api/admin/users", params={"pageSize": 101}).status_code == 422

	denied = client.patch(f"/api/admin/users/{created[0]['id']}/role", json={"role": "admin"})
	assert denied.status_code == 403


def test_owner_changes_roles_with_audit_and_existing_session_permissions(client):
	owner = _create_user(UserRole.OWNER)
	target = _create_user()
	_login(client, owner)

	with TestClient(app) as target_client:
		csrf = target_client.get("/api/auth/csrf").json()["csrfToken"]
		target_client.headers.update({"X-CSRF-Token": csrf})
		_login(target_client, target)
		assert target_client.get("/api/admin/users").status_code == 403

		promoted = client.patch(
			f"/api/admin/users/{target['id']}/role",
			json={"role": "admin"},
			headers={"X-Request-ID": "role-change-promote"},
		)
		assert promoted.status_code == 200
		assert promoted.json()["changed"] is True
		assert promoted.json()["user"]["role"] == "admin"
		assert target_client.get("/api/admin/users").status_code == 200

		unchanged = client.patch(f"/api/admin/users/{target['id']}/role", json={"role": "admin"})
		assert unchanged.status_code == 200
		assert unchanged.json()["changed"] is False

		demoted = client.patch(f"/api/admin/users/{target['id']}/role", json={"role": "user"})
		assert demoted.status_code == 200
		assert demoted.json()["user"]["role"] == "user"
		assert target_client.get("/api/admin/users").status_code == 403

	with SessionLocal() as db:
		events = list(db.scalars(select(RoleChangeAudit).where(
			RoleChangeAudit.target_user_id == target["id"],
		).order_by(RoleChangeAudit.created_at)))
	assert [(event.old_role, event.new_role) for event in events] == [
		(UserRole.USER, UserRole.ADMIN),
		(UserRole.ADMIN, UserRole.USER),
	]
	assert events[0].actor_user_id == owner["id"]
	assert events[0].correlation_id == "role-change-promote"


def test_owner_cannot_assign_owner_change_owner_or_unknown_user(client):
	owner = _create_user(UserRole.OWNER)
	target = _create_user()
	_login(client, owner)

	assert client.patch(f"/api/admin/users/{target['id']}/role", json={"role": "owner"}).status_code == 422
	assert client.patch(f"/api/admin/users/{owner['id']}/role", json={"role": "user"}).status_code == 403
	assert client.patch(f"/api/admin/users/{uuid4()}/role", json={"role": "admin"}).status_code == 404
	assert client.patch(f"/api/admin/users/{target['id']}/role", json={"role": "invalid"}).status_code == 422


def test_audit_failure_rolls_back_role_change(client, monkeypatch):
	owner = _create_user(UserRole.OWNER)
	target = _create_user()
	_login(client, owner)

	def fail_audit(**_kwargs):
		raise RuntimeError("audit unavailable")

	monkeypatch.setattr(admin_users, "RoleChangeAudit", fail_audit)
	with pytest.raises(RuntimeError, match="audit unavailable"):
		client.patch(f"/api/admin/users/{target['id']}/role", json={"role": "admin"})

	with SessionLocal() as db:
		persisted = db.get(User, target["id"])
		assert persisted is not None
		assert persisted.role == UserRole.USER
		assert db.scalar(select(RoleChangeAudit.id).where(RoleChangeAudit.target_user_id == target["id"])) is None
