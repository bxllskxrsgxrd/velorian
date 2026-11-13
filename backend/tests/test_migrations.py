from sqlalchemy import create_engine, inspect, text

from app.migrations import _add_user_logins


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
