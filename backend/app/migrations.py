from collections.abc import Callable

from sqlalchemy import Column, DateTime, MetaData, String, Table, inspect, insert, select, text
from sqlalchemy.engine import Connection

from .models import utc_now


MIGRATION_METADATA = MetaData()
SCHEMA_MIGRATIONS = Table(
	"schema_migrations",
	MIGRATION_METADATA,
	Column("version", String(64), primary_key=True),
	Column("applied_at", DateTime(timezone=True), nullable=False),
)


def _create_ratings_and_knowledge(connection: Connection) -> None:
	from .database import Base

	for table_name in ("message_ratings", "knowledge_items"):
		Base.metadata.tables[table_name].create(bind=connection, checkfirst=True)


def _add_storage_keys(connection: Connection) -> None:
	inspector = inspect(connection)
	for table_name in ("attachments", "knowledge_items"):
		columns = {column["name"] for column in inspector.get_columns(table_name)}
		if "storage_key" not in columns:
			connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN storage_key VARCHAR(1024)"))
	index_statements = (
		"CREATE INDEX IF NOT EXISTS ix_attachments_storage_key ON attachments (storage_key)",
		"CREATE INDEX IF NOT EXISTS ix_knowledge_items_storage_key ON knowledge_items (storage_key)",
	)
	for statement in index_statements:
		connection.execute(text(statement))


def _add_message_error_fields(connection: Connection) -> None:
	columns = {column["name"] for column in inspect(connection).get_columns("messages")}
	statements = {
		"error_code": "ALTER TABLE messages ADD COLUMN error_code VARCHAR(64)",
		"request_id": "ALTER TABLE messages ADD COLUMN request_id VARCHAR(128)",
	}
	for column, statement in statements.items():
		if column not in columns:
			connection.execute(text(statement))


def _add_message_search_mode(connection: Connection) -> None:
	columns = {column["name"] for column in inspect(connection).get_columns("messages")}
	if "search_mode" not in columns:
		connection.execute(text("ALTER TABLE messages ADD COLUMN search_mode VARCHAR(16) NOT NULL DEFAULT 'none'"))


MIGRATIONS: tuple[tuple[str, Callable[[Connection], None]], ...] = (
	("20260825_01_ratings_and_knowledge", _create_ratings_and_knowledge),
	("20260825_02_storage_keys", _add_storage_keys),
	("20260826_01_message_error_fields", _add_message_error_fields),
	("20260826_02_message_search_mode", _add_message_search_mode),
)


def run_migrations(connection: Connection) -> None:
	SCHEMA_MIGRATIONS.create(bind=connection, checkfirst=True)
	applied = set(connection.scalars(select(SCHEMA_MIGRATIONS.c.version)))
	for version, migration in MIGRATIONS:
		if version in applied:
			continue
		migration(connection)
		connection.execute(insert(SCHEMA_MIGRATIONS).values(version=version, applied_at=utc_now()))
