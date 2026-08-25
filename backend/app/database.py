from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
	pass


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)

if settings.database_url.startswith("sqlite"):
	@event.listens_for(engine, "connect")
	def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
		cursor = dbapi_connection.cursor()
		cursor.execute("PRAGMA foreign_keys=ON")
		cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_database() -> None:
	from . import models  # noqa: F401
	from .migrations import run_migrations

	existing_tables = [table for name, table in Base.metadata.tables.items() if name not in {"message_ratings", "knowledge_items"}]
	Base.metadata.create_all(bind=engine, tables=existing_tables)
	with engine.begin() as connection:
		run_migrations(connection)
	columns = {column["name"] for column in inspect(engine).get_columns("messages")}
	boolean_default = "1" if engine.dialect.name == "sqlite" else "TRUE"
	statements = {
		"branch_group_id": "ALTER TABLE messages ADD COLUMN branch_group_id VARCHAR(36)",
		"reply_to_id": "ALTER TABLE messages ADD COLUMN reply_to_id VARCHAR(36)",
		"is_active": f"ALTER TABLE messages ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT {boolean_default}",
	}
	with engine.begin() as connection:
		for column, statement in statements.items():
			if column not in columns:
				connection.execute(text(statement))


def get_db() -> Generator[Session, None, None]:
	db = SessionLocal()
	try:
		yield db
	finally:
		db.close()
