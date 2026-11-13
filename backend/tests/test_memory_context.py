from dataclasses import replace
from uuid import uuid4

from sqlalchemy import select

from app.database import SessionLocal
from app.memory import add_memory_decision, upsert_preference_memory, upsert_project_memory
from app.models import BranchSummary, Message, User


def _context_token_values(log: str) -> dict[str, int]:
	names = (
		"system_tokens",
		"summary_tokens",
		"history_tokens",
		"memory_tokens",
		"knowledge_tokens",
		"user_tokens",
		"total_tokens",
	)
	return {
		name: int(next(part for part in log.split() if part.startswith(f"{name}=")).split("=", 1)[1])
		for name in names
	}


def test_chat_context_includes_only_relevant_user_memory(authenticated_client, caplog):
	import app.main as main_module

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Relevant memory"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	query = "Как настроена database PostgreSQL?"
	with SessionLocal() as db:
		upsert_project_memory(db, user_id, "database", "PostgreSQL")
		upsert_project_memory(db, user_id, "deployment_platform", "Kubernetes")
		upsert_preference_memory(db, user_id, "favorite_editor", "Vim")
		add_memory_decision(db, user_id, "Use Redis for caching")
		other_user = User(
			email=f"memory-other-{uuid4()}@example.com",
			login=f"memory-other-{uuid4()}",
			password_hash="hash",
		)
		db.add(other_user)
		db.commit()
		upsert_project_memory(db, other_user.id, "database", "FOREIGN_MYSQL_SECRET")
		current = Message(conversation_id=conversation_id, role="user", content=query)
		db.add(current)
		db.commit()

		with caplog.at_level("INFO", logger="uvicorn.error"):
			context, _, _, _ = main_module.build_chat_context(
				db, conversation_id, user_id, query, current,
			)

	memory_messages = [
		message for message in context
		if message["content"].startswith(main_module.STRUCTURED_MEMORY_CONTEXT_PREFIX)
	]
	assert len(memory_messages) == 1
	assert '"database": "PostgreSQL"' in memory_messages[0]["content"]
	assert "Kubernetes" not in memory_messages[0]["content"]
	assert "Vim" not in memory_messages[0]["content"]
	assert "Redis" not in memory_messages[0]["content"]
	assert "FOREIGN_MYSQL_SECRET" not in memory_messages[0]["content"]
	assert context[-1] == {"role": "user", "content": query}

	context_log = next(
		record.getMessage() for record in reversed(caplog.records)
		if record.getMessage().startswith("AI context size ")
	)
	tokens = _context_token_values(context_log)
	assert tokens["memory_tokens"] == main_module.estimate_tokens(memory_messages[0]["content"])
	assert tokens["memory_tokens"] > 0
	assert tokens["total_tokens"] == sum(
		value for name, value in tokens.items() if name != "total_tokens"
	)
	assert tokens["total_tokens"] <= main_module.settings.chat_context_budget


def test_chat_context_without_relevant_memory_is_unchanged(authenticated_client, caplog):
	import app.main as main_module

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "No relevant memory"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	query = "Объясни рекурсию"
	with SessionLocal() as db:
		upsert_project_memory(db, user_id, "database", "PostgreSQL")
		current = Message(conversation_id=conversation_id, role="user", content=query)
		db.add(current)
		db.commit()
		with caplog.at_level("INFO", logger="uvicorn.error"):
			context, _, _, _ = main_module.build_chat_context(
				db, conversation_id, user_id, query, current,
			)

	assert context == [
		{"role": "system", "content": main_module.CHAT_PROMPT},
		{"role": "user", "content": query},
	]
	context_log = next(
		record.getMessage() for record in reversed(caplog.records)
		if record.getMessage().startswith("AI context size ")
	)
	assert _context_token_values(context_log)["memory_tokens"] == 0


def test_chat_context_drops_relevant_memory_when_budget_is_exhausted(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Memory budget"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	query = "database PostgreSQL"
	base_tokens = main_module.estimate_tokens(main_module.CHAT_PROMPT) + main_module.estimate_tokens(query)
	monkeypatch.setattr(
		main_module,
		"settings",
		replace(main_module.settings, chat_context_budget=base_tokens),
	)
	with SessionLocal() as db:
		upsert_project_memory(db, user_id, "database", "PostgreSQL")
		current = Message(conversation_id=conversation_id, role="user", content=query)
		db.add(current)
		db.commit()
		with caplog.at_level("INFO", logger="uvicorn.error"):
			context, _, _, _ = main_module.build_chat_context(
				db, conversation_id, user_id, query, current,
			)

	assert context == [
		{"role": "system", "content": main_module.CHAT_PROMPT},
		{"role": "user", "content": query},
	]
	context_log = next(
		record.getMessage() for record in reversed(caplog.records)
		if record.getMessage().startswith("AI context size ")
	)
	tokens = _context_token_values(context_log)
	assert tokens["memory_tokens"] == 0
	assert tokens["total_tokens"] == base_tokens
	assert tokens["total_tokens"] <= main_module.settings.chat_context_budget


def test_relevant_memory_has_priority_over_optional_knowledge(authenticated_client, monkeypatch, caplog):
	import app.main as main_module

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Memory priority"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	query = "database PostgreSQL"
	with SessionLocal() as db:
		memory_item = upsert_project_memory(db, user_id, "database", "PostgreSQL")
		memory_content = main_module._format_structured_memory_context([memory_item])
		budget = (
			main_module.estimate_tokens(main_module.KNOWLEDGE_PROMPT)
			+ main_module.estimate_tokens(query)
			+ main_module.estimate_tokens(memory_content)
		)
		monkeypatch.setattr(
			main_module,
			"settings",
			replace(main_module.settings, chat_context_budget=budget),
		)
		monkeypatch.setattr(main_module, "retrieve_knowledge", lambda *args, **kwargs: object())
		monkeypatch.setattr(main_module, "_format_knowledge_context", lambda result: "OPTIONAL_KNOWLEDGE " * 100)
		monkeypatch.setattr(main_module, "log_knowledge_retrieval", lambda *args, **kwargs: None)
		current = Message(conversation_id=conversation_id, role="user", content=query)
		db.add(current)
		db.commit()
		with caplog.at_level("INFO", logger="uvicorn.error"):
			context, _, _, _ = main_module.build_chat_context(
				db, conversation_id, user_id, query, current, knowledge_search=True,
			)

	serialized_context = "\n".join(message["content"] for message in context)
	assert memory_content in serialized_context
	assert "OPTIONAL_KNOWLEDGE" not in serialized_context
	context_log = next(
		record.getMessage() for record in reversed(caplog.records)
		if record.getMessage().startswith("AI context size ")
	)
	tokens = _context_token_values(context_log)
	assert tokens["memory_tokens"] == main_module.estimate_tokens(memory_content)
	assert tokens["knowledge_tokens"] == 0
	assert tokens["total_tokens"] <= budget


def test_memory_context_does_not_change_sibling_branch_isolation(authenticated_client):
	import app.main as main_module

	conversation_id = authenticated_client.post(
		"/api/conversations", json={"title": "Memory and sibling isolation"},
	).json()["conversation"]["id"]
	user_id = authenticated_client.get("/api/auth/me").json()["user"]["id"]
	with SessionLocal() as db:
		a = Message(id=str(uuid4()), conversation_id=conversation_id, role="user", content="A")
		b = Message(id=str(uuid4()), conversation_id=conversation_id, role="assistant", content="B", reply_to_id=a.id)
		c = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="C OLD_C_UNIQUE_FACT", reply_to_id=b.id, is_active=False,
		)
		d = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="assistant",
			content="D OLD_D_UNIQUE_FACT", reply_to_id=c.id,
		)
		c2 = Message(
			id=str(uuid4()), conversation_id=conversation_id, role="user",
			content="C2 current_branch", reply_to_id=b.id, is_active=True,
		)
		db.add_all([a, b, c, d, c2])
		db.flush()
		db.add(BranchSummary(
			conversation_id=conversation_id,
			branch_anchor_message_id=c.id,
			summarized_through_message_id=d.id,
			summary_text="SIBLING_SUMMARY_WITH_C_D_FACTS",
		))
		db.commit()
		upsert_project_memory(db, user_id, "current_branch", "C2 selected")

		context, _, _, _ = main_module.build_chat_context(
			db, conversation_id, user_id, c2.content, c2,
		)
		conversation_messages = list(db.scalars(
			select(Message)
			.where(Message.conversation_id == conversation_id)
			.order_by(Message.created_at, Message.id)
		))
		active_path = main_module._message_path(conversation_messages, c2.id)

	assert [message.content for message in active_path] == ["A", "B", "C2 current_branch"]
	serialized_context = "\n".join(message["content"] for message in context)
	assert "current_branch" in serialized_context
	assert "SIBLING_SUMMARY_WITH_C_D_FACTS" not in serialized_context
	assert "OLD_C_UNIQUE_FACT" not in serialized_context
	assert "OLD_D_UNIQUE_FACT" not in serialized_context
