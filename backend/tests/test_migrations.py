from sqlalchemy import create_engine, inspect, text

from app.migrations import _add_user_logins, _add_user_roles, _create_role_change_audits


def test_add_user_logins_backfills_unique_values_for_existing_accounts(tmp_path):
	engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
	with engine.begin() as connection:
		connection.execute(text(
			"CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(320) NOT NULL, "
			"password_hash VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL)"
		))
		connection.execute(text(
			"INSERT INTO users (id, email, password_hash, created_at) VALUES "
			"('one', 'poet@example.com', 'hash', '2026-01-01'), "
			"('two', 'poet@other.example', 'hash', '2026-01-02')"
		))
		_add_user_logins(connection)
		_add_user_logins(connection)
		logins = list(connection.scalars(text("SELECT login FROM users ORDER BY created_at")))

	assert logins == ["poet", "poet-2"]
	assert any(
		index["name"] == "ix_users_login" and index["unique"] for index in inspect(engine).get_indexes("users")
	)


def test_add_user_roles_preserves_existing_accounts_and_related_data(tmp_path):
	engine = create_engine(f"sqlite:///{tmp_path / 'legacy-roles.db'}")
	with engine.begin() as connection:
		connection.execute(text(
			"CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(320) NOT NULL, "
			"login VARCHAR(80) NOT NULL, password_hash VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL)"
		))
		connection.execute(text(
			"CREATE TABLE conversations (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, "
			"title VARCHAR(160) NOT NULL)"
		))
		connection.execute(text(
			"INSERT INTO users (id, email, login, password_hash, created_at) VALUES "
			"('legacy', 'legacy@example.com', 'legacy', 'preserved-hash', '2026-01-01')"
		))
		connection.execute(text(
			"INSERT INTO conversations (id, user_id, title) VALUES ('chat', 'legacy', 'Preserved chat')"
		))
		_add_user_roles(connection)
		_add_user_roles(connection)
		user = connection.execute(text(
			"SELECT email, login, password_hash, role FROM users WHERE id = 'legacy'"
		)).one()
		conversation = connection.execute(text(
			"SELECT user_id, title FROM conversations WHERE id = 'chat'"
		)).one()

	assert user == ("legacy@example.com", "legacy", "preserved-hash", "user")
	assert conversation == ("legacy", "Preserved chat")
	assert any(index["name"] == "uq_users_single_owner" for index in inspect(engine).get_indexes("users"))


def test_create_role_change_audits_is_idempotent(tmp_path):
	engine = create_engine(f"sqlite:///{tmp_path / 'role-audits.db'}")
	with engine.begin() as connection:
		connection.execute(text(
			"CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR(320) NOT NULL, "
			"login VARCHAR(80) NOT NULL, password_hash VARCHAR(255) NOT NULL, "
			"role VARCHAR(16) NOT NULL, created_at DATETIME NOT NULL)"
		))
		_create_role_change_audits(connection)
		_create_role_change_audits(connection)

	columns = {column["name"] for column in inspect(engine).get_columns("role_change_audits")}
	assert columns == {
		"id", "actor_user_id", "target_user_id", "old_role", "new_role", "created_at", "correlation_id",
	}
