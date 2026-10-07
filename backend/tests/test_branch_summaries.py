from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.main import _branch_summary_applies, _message_path
from app.migrations import _create_branch_summaries
from app.models import BranchSummary, Conversation, Message, User


def test_sibling_branches_have_independent_summaries():
	engine = create_engine("sqlite:///:memory:")
	Base.metadata.create_all(engine, tables=[
		Base.metadata.tables["users"],
		Base.metadata.tables["conversations"],
		Base.metadata.tables["messages"],
	])
	with engine.begin() as connection:
		_create_branch_summaries(connection)
		_create_branch_summaries(connection)

	with Session(engine) as db:
		user = User(email="branches@example.com", login="branches", password_hash="hash")
		conversation = Conversation(user=user)
		root = Message(id="root", conversation=conversation, role="user", content="root")
		common = Message(id="common", conversation=conversation, role="assistant", content="common", reply_to_id=root.id)
		left = Message(id="left", conversation=conversation, role="user", content="left", reply_to_id=common.id)
		left_tip = Message(id="left-tip", conversation=conversation, role="assistant", content="left answer", reply_to_id=left.id)
		right = Message(id="right", conversation=conversation, role="user", content="right", reply_to_id=common.id)
		right_tip = Message(id="right-tip", conversation=conversation, role="assistant", content="right answer", reply_to_id=right.id)
		db.add_all([
			BranchSummary(
				conversation=conversation,
				branch_anchor_message_id=left.id,
				summarized_through_message_id=left_tip.id,
				summary_text="left summary",
			),
			BranchSummary(
				conversation=conversation,
				branch_anchor_message_id=right.id,
				summarized_through_message_id=right_tip.id,
				summary_text="right summary",
			),
		])
		db.commit()

		messages = list(db.scalars(select(Message).where(Message.conversation_id == conversation.id)))
		summaries = list(db.scalars(select(BranchSummary).order_by(BranchSummary.summary_text)))
		left_path = _message_path(messages, left_tip.id)
		right_path = _message_path(messages, right_tip.id)

		assert [summary.summary_text for summary in summaries] == ["left summary", "right summary"]
		assert _branch_summary_applies(summaries[0], left_path)
		assert not _branch_summary_applies(summaries[0], right_path)
		assert _branch_summary_applies(summaries[1], right_path)
		assert not _branch_summary_applies(summaries[1], left_path)
