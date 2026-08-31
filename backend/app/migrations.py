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


def _add_dynamic_knowledge_filters(connection: Connection) -> None:
	from .database import Base

	definition_table = Base.metadata.tables["knowledge_filter_definitions"]
	option_table = Base.metadata.tables["knowledge_filter_options"]
	value_table = Base.metadata.tables["knowledge_item_filter_values"]
	for table in (definition_table, option_table, value_table):
		table.create(bind=connection, checkfirst=True)

	approach_table = Base.metadata.tables["knowledge_approaches"]
	item_table = Base.metadata.tables["knowledge_items"]
	definitions = {
		row.user_id: row.id
		for row in connection.execute(select(definition_table.c.id, definition_table.c.user_id).where(
			definition_table.c.slug == "podhod",
		))
	}
	for user_id in connection.scalars(text("SELECT id FROM users")):
		if user_id in definitions:
			continue
		definition_id = new_id()
		connection.execute(insert(definition_table).values(
			id=definition_id, user_id=user_id, name="Подход", slug="podhod", type="single_select",
			is_system=True, created_at=utc_now(), updated_at=utc_now(),
		))
		definitions[user_id] = definition_id

	option_by_approach: dict[str, str] = {}
	for approach in connection.execute(select(approach_table.c.id, approach_table.c.user_id, approach_table.c.name, approach_table.c.slug)):
		definition_id = definitions[approach.user_id]
		existing_option = connection.scalar(select(option_table.c.id).where(
			option_table.c.filter_definition_id == definition_id,
			option_table.c.normalized_value == approach.slug,
		))
		option_id = existing_option or new_id()
		if existing_option is None:
			connection.execute(insert(option_table).values(
				id=option_id, filter_definition_id=definition_id, value=approach.name,
				normalized_value=approach.slug, created_at=utc_now(), updated_at=utc_now(),
			))
		option_by_approach[approach.id] = option_id

	existing_values = set(connection.execute(select(value_table.c.knowledge_item_id, value_table.c.filter_definition_id)).all())
	for item in connection.execute(select(item_table.c.id, item_table.c.user_id, item_table.c.approach_id).where(item_table.c.approach_id.is_not(None))):
		definition_id = definitions[item.user_id]
		option_id = option_by_approach.get(item.approach_id)
		if option_id and (item.id, definition_id) not in existing_values:
			connection.execute(insert(value_table).values(
				id=new_id(), knowledge_item_id=item.id, filter_definition_id=definition_id,
				filter_option_id=option_id, created_at=utc_now(),
			))

	# Text authored in the Knowledge editor is a Markdown document. The title stays
	# separate and is never prepended to content.
	for item in connection.execute(select(item_table.c.id, item_table.c.source_type, item_table.c.original_filename, item_table.c.mime_type)):
		if item.source_type not in {"manual", "rated_content", "assistant_message"}:
			continue
		filename = item.original_filename or f"knowledge-{item.id}.md"
		if not filename.lower().endswith(".md"):
			filename = f"{filename}.md"
		connection.execute(item_table.update().where(item_table.c.id == item.id).values(
			mime_type="text/markdown", original_filename=filename,
		))


def _add_knowledge_source_message_ref(connection: Connection) -> None:
	columns = {column["name"] for column in inspect(connection).get_columns("knowledge_items")}
	if "source_message_ref_id" not in columns:
		connection.execute(text("ALTER TABLE knowledge_items ADD COLUMN source_message_ref_id VARCHAR(36)"))
	connection.execute(text(
		"CREATE INDEX IF NOT EXISTS ix_knowledge_items_source_message_ref_id ON knowledge_items (source_message_ref_id)"
	))


MIGRATIONS: tuple[tuple[str, Callable[[Connection], None]], ...] = (
	("20260825_01_ratings_and_knowledge", _create_ratings_and_knowledge),
	("20260825_02_storage_keys", _add_storage_keys),
	("20260826_01_message_error_fields", _add_message_error_fields),
	("20260826_02_message_search_mode", _add_message_search_mode),
	("20260826_03_knowledge_sources_and_indexes", _add_knowledge_sources_and_indexes),
	("20260826_04_knowledge_created_index", _add_knowledge_created_index),
	("20260827_01_knowledge_approaches", _add_knowledge_approaches),
	("20260828_01_dynamic_knowledge_filters", _add_dynamic_knowledge_filters),
	("20260828_02_knowledge_source_message_ref", _add_knowledge_source_message_ref),
)


def run_migrations(connection: Connection) -> None:
	SCHEMA_MIGRATIONS.create(bind=connection, checkfirst=True)
	applied = set(connection.scalars(select(SCHEMA_MIGRATIONS.c.version)))
	for version, migration in MIGRATIONS:
		if version in applied:
			continue
		migration(connection)
		connection.execute(insert(SCHEMA_MIGRATIONS).values(version=version, applied_at=utc_now()))
