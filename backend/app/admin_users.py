from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .auth import require_admin, require_owner
from .config import settings
from .database import get_db
from .errors import AppError
from .models import RoleChangeAudit, User
from .observability import record_activity_event
from .roles import UserRole, parse_user_role


router = APIRouter(prefix=f"{settings.api_prefix}/admin/users", tags=["admin"])


class RoleUpdatePayload(BaseModel):
	role: Literal["user", "admin"]


def _user_payload(user: User) -> dict:
	return {
		"id": user.id,
		"login": user.login,
		"email": user.email,
		"role": parse_user_role(user.role).value,
		"createdAt": user.created_at.isoformat(),
	}


def _escaped_search(value: str) -> str:
	return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("")
def list_admin_users(
	search: str = Query(default="", max_length=320),
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
	_user: User = Depends(require_admin),
	db: Session = Depends(get_db),
):
	query = select(User)
	term = search.strip()
	if term:
		pattern = f"%{_escaped_search(term)}%"
		query = query.where(or_(
			User.login.ilike(pattern, escape="\\"),
			User.email.ilike(pattern, escape="\\"),
		))
	total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
	users = db.scalars(
		query.order_by(func.lower(User.login), User.id).offset((page - 1) * page_size).limit(page_size)
	).all()
	total_pages = (total + page_size - 1) // page_size
	return {
		"users": [_user_payload(user) for user in users],
		"page": page,
		"pageSize": page_size,
		"total": total,
		"totalPages": total_pages,
	}


@router.patch("/{user_id}/role")
def update_admin_user_role(
	user_id: str,
	payload: RoleUpdatePayload,
	request: Request,
	actor: User = Depends(require_owner),
	db: Session = Depends(get_db),
):
	target = db.get(User, user_id)
	if target is None:
		raise AppError(404, "USER_NOT_FOUND", "Пользователь не найден")
	if target.id == actor.id:
		raise AppError(403, "SELF_ROLE_CHANGE_FORBIDDEN", "Нельзя изменить собственную роль")
	old_role = parse_user_role(target.role)
	if old_role == UserRole.OWNER:
		raise AppError(403, "OWNER_ROLE_IMMUTABLE", "Роль владельца нельзя изменить через API")
	new_role = UserRole(payload.role)
	if old_role == new_role:
		return {"user": _user_payload(target), "changed": False}

	try:
		target.role = new_role
		audit = RoleChangeAudit(
			actor_user_id=actor.id,
			target_user_id=target.id,
			old_role=old_role,
			new_role=new_role,
			correlation_id=getattr(request.state, "request_id", None),
		)
		db.add(audit)
		db.commit()
	except Exception:
		db.rollback()
		raise
	record_activity_event(
		user_id=actor.id,
		event_type="admin.role_changed",
		resource_type="role_change_audit",
		resource_id=audit.id,
		correlation_id=getattr(request.state, "request_id", None),
	)
	return {"user": _user_payload(target), "changed": True}
