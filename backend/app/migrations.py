from collections.abc import Callable

from sqlalchemy import Column, DateTime, MetaData, String, Table, inspect, insert, select, text
from sqlalchemy.engine import Connection

from .models import new_id, utc_now


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


def _add_knowledge_sources_and_indexes(connection: Connection) -> None:
	message_columns = {column["name"] for column in inspect(connection).get_columns("messages")}
	if "knowledge_sources" not in message_columns:
		connection.execute(text("ALTER TABLE messages ADD COLUMN knowledge_sources JSON"))
	for statement in (
		"CREATE INDEX IF NOT EXISTS ix_knowledge_user_rating ON knowledge_items (user_id, rating)",
		"CREATE INDEX IF NOT EXISTS ix_knowledge_user_updated ON knowledge_items (user_id, updated_at, id)",
	):
		connection.execute(text(statement))


def _add_knowledge_created_index(connection: Connection) -> None:
	connection.execute(text(
		"CREATE INDEX IF NOT EXISTS ix_knowledge_user_created ON knowledge_items (user_id, created_at, id)"
	))


def _add_knowledge_approaches(connection: Connection) -> None:
	from .database import Base

	approach_table = Base.metadata.tables["knowledge_approaches"]
	approach_table.create(bind=connection, checkfirst=True)
	columns = {column["name"] for column in inspect(connection).get_columns("knowledge_items")}
	if "approach_id" not in columns:
		connection.execute(text(
			"ALTER TABLE knowledge_items ADD COLUMN approach_id VARCHAR(36) "
			"REFERENCES knowledge_approaches(id) ON DELETE SET NULL"
		))
	for statement in (
		"CREATE INDEX IF NOT EXISTS ix_knowledge_items_approach_id ON knowledge_items (approach_id)",
		"CREATE INDEX IF NOT EXISTS ix_knowledge_user_active_approach ON knowledge_items (user_id, is_active, approach_id)",
	):
		connection.execute(text(statement))

	existing = set(connection.execute(select(approach_table.c.user_id, approach_table.c.slug)).all())
	user_ids = list(connection.scalars(text("SELECT id FROM users")))
	for user_id in user_ids:
		for name, slug in (("Интервью", "интервью"), ("Шоу", "шоу")):
			if (user_id, slug) not in existing:
				connection.execute(insert(approach_table).values(
					id=new_id(), user_id=user_id, name=name, slug=slug, created_at=utc_now(), updated_at=utc_now(),
				))


def _add_trash_timestamps(connection: Connection) -> None:
	column_type = "DATETIME" if connection.dialect.name == "sqlite" else "TIMESTAMP WITH TIME ZONE"
	for table_name in ("conversations", "knowledge_items"):
		columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
		if "deleted_at" not in columns:
			connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN deleted_at {column_type}"))
		connection.execute(text(
			f"CREATE INDEX IF NOT EXISTS ix_{table_name}_deleted_at ON {table_name} (deleted_at)"
		))


MIGRATIONS: tuple[tuple[str, Callable[[Connection], None]], ...] = (
	("20260825_01_ratings_and_knowledge", _create_ratings_and_knowledge),
	("20260825_02_storage_keys", _add_storage_keys),
	("20260826_01_message_error_fields", _add_message_error_fields),
	("20260826_02_message_search_mode", _add_message_search_mode),
	("20260826_03_knowledge_sources_and_indexes", _add_knowledge_sources_and_indexes),
	("20260826_04_knowledge_created_index", _add_knowledge_created_index),
	("20260827_01_knowledge_approaches", _add_knowledge_approaches),
	("20260904_01_unified_trash", _add_trash_timestamps),
)


def run_migrations(connection: Connection) -> None:
	SCHEMA_MIGRATIONS.create(bind=connection, checkfirst=True)
	applied = set(connection.scalars(select(SCHEMA_MIGRATIONS.c.version)))
	for version, migration in MIGRATIONS:
		if version in applied:
			continue
		migration(connection)
		connection.execute(insert(SCHEMA_MIGRATIONS).values(version=version, applied_at=utc_now()))
