import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.database import Base
from app.memory import add_memory_decision, read_user_memory, upsert_preference_memory, upsert_project_memory
from app.migrations import _create_structured_memory
from app.models import StructuredMemoryItem, User


@pytest.fixture
def db():
	engine = create_engine("sqlite:///:memory:")
	Base.metadata.tables["users"].create(bind=engine)
	with engine.begin() as connection:
		_create_structured_memory(connection)
		_create_structured_memory(connection)
	with Session(engine) as session:
		yield session
	engine.dispose()


def test_structured_memory_persists_and_upserts_named_values(db: Session):
	user = User(email="memory@example.com", login="memory", password_hash="hash")
	db.add(user)
	db.commit()

	project = upsert_project_memory(db, user.id, "repository", "velorian")
	project_id = project.id
	upsert_project_memory(db, user.id, "repository", {"name": "velorian", "language": "Python"})
	preference = upsert_preference_memory(db, user.id, "response_style", "detailed")
	preference_id = preference.id
	assert upsert_preference_memory(db, user.id, "response_style", "concise").id == preference_id
	add_memory_decision(db, user.id, "Use branch-scoped summaries")
	add_memory_decision(db, user.id, {"decision": "Keep memory out of chat context"})

	assert db.scalar(select(func.count()).select_from(StructuredMemoryItem).where(
		StructuredMemoryItem.user_id == user.id,
		StructuredMemoryItem.category == "project",
		StructuredMemoryItem.name == "repository",
	)) == 1
	assert db.scalar(select(StructuredMemoryItem.id).where(
		StructuredMemoryItem.user_id == user.id,
		StructuredMemoryItem.category == "project",
		StructuredMemoryItem.name == "repository",
	)) == project_id
	assert read_user_memory(db, user.id) == {
		"project": {"repository": {"name": "velorian", "language": "Python"}},
		"preferences": {"response_style": "concise"},
		"decisions": ["Use branch-scoped summaries", {"decision": "Keep memory out of chat context"}],
	}


def test_structured_memory_is_isolated_by_user(db: Session):
	first = User(email="first-memory@example.com", login="first-memory", password_hash="hash")
	second = User(email="second-memory@example.com", login="second-memory", password_hash="hash")
	db.add_all([first, second])
	db.commit()

	upsert_project_memory(db, first.id, "repository", "first-private-project")
	upsert_project_memory(db, second.id, "repository", "second-private-project")
	add_memory_decision(db, first.id, "first-private-decision")
	add_memory_decision(db, second.id, "second-private-decision")

	assert read_user_memory(db, first.id) == {
		"project": {"repository": "first-private-project"},
		"preferences": {},
		"decisions": ["first-private-decision"],
	}
	assert read_user_memory(db, second.id) == {
		"project": {"repository": "second-private-project"},
		"preferences": {},
		"decisions": ["second-private-decision"],
	}
