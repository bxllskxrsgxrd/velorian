from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app import admin_cli
from app.admin_cli import BootstrapOwnerError, bootstrap_owner
from app.auth import require_admin, require_owner
from app.database import SessionLocal
from app.errors import AppError
from app.migrations import _add_user_roles
from app.models import User
from app.roles import UserRole


def _legacy_user_engine(tmp_path):
	engine = create_engine(f"sqlite:///{tmp_path / 'roles.db'}")
	with engine.begin() as connection:
		connection.execute(text(
			"CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(320) NOT NULL, "
			"login VARCHAR(80) NOT NULL, password_hash VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL)"
		))
		connection.execute(text(
			"INSERT INTO users (id, email, login, password_hash, created_at) VALUES "
			"('first', 'first@example.com', 'first', 'hash-one', '2026-01-01'), "
			"('second', 'second@example.com', 'second', 'hash-two', '2026-01-02')"
		))
		_add_user_roles(connection)
	return engine


def test_registration_forces_user_role_and_me_returns_current_role(client):
	registered = client.post("/api/auth/register", json={
		"login": "role-user",
		"email": "role-user@example.com",
		"password": "strong-password",
		"role": "owner",
	})
	assert registered.status_code == 200
	assert registered.json()["user"]["role"] == "user"
	client.headers.update({"X-CSRF-Token": registered.json()["csrfToken"]})
	user_id = registered.json()["user"]["id"]

	with SessionLocal() as db:
		user = db.get(User, user_id)
		assert user is not None
		assert user.role == UserRole.USER
		user.role = UserRole.ADMIN
		db.commit()

	current = client.get("/api/auth/me")
	assert current.status_code == 200
	assert current.json()["user"]["role"] == "admin"


def test_role_dependencies_enforce_user_admin_owner_hierarchy(client):
	unauthorized = client.get("/api/conversations")
	assert unauthorized.status_code == 401
	assert unauthorized.json()["error"]["code"] == "AUTH_REQUIRED"

	user = SimpleNamespace(role=UserRole.USER)
	admin = SimpleNamespace(role=UserRole.ADMIN)
	owner = SimpleNamespace(role=UserRole.OWNER)
	with pytest.raises(AppError) as user_denied:
		require_admin(user)
	assert user_denied.value.status_code == 403
	assert user_denied.value.code == "INSUFFICIENT_ROLE"
	assert require_admin(admin) is admin
	assert require_admin(owner) is owner
	with pytest.raises(AppError) as admin_denied:
		require_owner(admin)
	assert admin_denied.value.status_code == 403
	assert require_owner(owner) is owner


def test_bootstrap_owner_cli_is_one_time_and_rejects_unknown_user(tmp_path, monkeypatch, capsys):
	engine = _legacy_user_engine(tmp_path)
	monkeypatch.setattr(admin_cli, "engine", engine)
	monkeypatch.setattr(admin_cli, "init_database", lambda: None)

	assert admin_cli.main(["bootstrap-owner", "--user-id", "first"]) == 0
	assert "назначен владельцем" in capsys.readouterr().out
	with engine.connect() as connection:
		assert connection.scalar(text("SELECT role FROM users WHERE id = 'first'")) == "owner"
		assert connection.scalar(text("SELECT role FROM users WHERE id = 'second'")) == "user"

	assert admin_cli.main(["bootstrap-owner", "--user-id", "second"]) == 1
	assert "повторная инициализация запрещена" in capsys.readouterr().err
	with pytest.raises(BootstrapOwnerError, match="не найден"):
		bootstrap_owner("missing", engine)
	with engine.connect() as connection:
		assert connection.scalar(text("SELECT COUNT(*) FROM users WHERE role = 'owner'")) == 1
	with pytest.raises(IntegrityError):
		with engine.begin() as connection:
			connection.execute(text("UPDATE users SET role = 'owner' WHERE id = 'second'"))

	engine.dispose()
