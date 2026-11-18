from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .models import AIUsageEvent, ActivityEvent, User, utc_now
from .observability import (
	aggregate_ai_usage,
	latest_successful_login,
	list_auth_activity,
	paginate_activity_events,
	paginate_ai_usage_events,
)
from .roles import parse_user_role


ProfilePeriod = Literal["7d", "30d", "90d", "all"]
UsageStatus = Literal["success", "error", "cancelled"]
PERIOD_DAYS: dict[ProfilePeriod, int | None] = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"all": None,
}

router = APIRouter(prefix=f"{settings.api_prefix}/profile", tags=["profile"])


def _period_start(period: ProfilePeriod) -> datetime | None:
	days = PERIOD_DAYS[period]
	return utc_now() - timedelta(days=days) if days is not None else None


def _cost_payload(value: object) -> str | None:
	if value is None:
		return None
	if isinstance(value, Decimal):
		return format(value, "f")
	return str(value)


def _usage_event_payload(event: AIUsageEvent) -> dict[str, object]:
	return {
		"id": event.id,
		"createdAt": event.created_at.isoformat(),
		"provider": event.provider,
		"model": event.model,
		"purpose": event.purpose,
		"taskType": event.task_type,
		"status": event.status,
		"inputTokens": event.input_tokens,
		"outputTokens": event.output_tokens,
		"cachedTokens": event.cached_tokens,
		"totalTokens": event.total_tokens,
		"estimatedCostUsd": _cost_payload(event.estimated_cost_usd),
		"latencyMs": event.latency_ms,
	}


def _activity_event_payload(event: ActivityEvent) -> dict[str, object]:
	return {
		"id": event.id,
		"eventType": event.event_type,
		"resourceType": event.resource_type,
		"status": event.status,
		"createdAt": event.created_at.isoformat(),
	}


@router.get("/usage")
def get_profile_usage(
	period: ProfilePeriod = Query(default="30d"),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	start = _period_start(period)
	usage = aggregate_ai_usage(db, user_id=user.id, start=start)
	totals = usage["totals"]
	return {
		"period": period,
		"from": start.isoformat() if start is not None else None,
		"totals": {
			"requestCount": totals["request_count"],
			"successCount": totals["success_count"],
			"errorCount": totals["error_count"],
			"cancelledCount": totals["cancelled_count"],
			"inputTokens": totals["input_tokens"],
			"outputTokens": totals["output_tokens"],
			"cachedTokens": totals["cached_tokens"],
			"totalTokens": totals["total_tokens"],
			"knownCostUsd": _cost_payload(totals["estimated_cost_usd"]),
			"unknownCostCount": totals["unknown_cost_count"],
			"unknownTokenCount": totals["unknown_token_count"],
		},
		"models": [{
			"provider": item["keys"][0],
			"model": item["keys"][1],
			"requestCount": item["request_count"],
			"totalTokens": item["total_tokens"],
			"knownCostUsd": _cost_payload(item["estimated_cost_usd"]),
			"unknownCostCount": item["unknown_cost_count"],
		} for item in usage["models"]],
		"purposes": [{
			"purpose": item["keys"][0],
			"requestCount": item["request_count"],
			"totalTokens": item["total_tokens"],
			"knownCostUsd": _cost_payload(item["estimated_cost_usd"]),
			"unknownCostCount": item["unknown_cost_count"],
		} for item in usage["purposes"]],
	}


@router.get("/usage/events")
def get_profile_usage_events(
	period: ProfilePeriod = Query(default="30d"),
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
	model: str = Query(default="", max_length=160),
	purpose: str = Query(default="", max_length=64),
	status: UsageStatus | None = Query(default=None),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	events, total = paginate_ai_usage_events(
		db,
		user_id=user.id,
		page=page,
		page_size=page_size,
		start=_period_start(period),
		model=model.strip() or None,
		purpose=purpose.strip() or None,
		status=status,
	)
	return {
		"events": [_usage_event_payload(event) for event in events],
		"page": page,
		"pageSize": page_size,
		"total": total,
		"totalPages": (total + page_size - 1) // page_size,
	}


@router.get("/activity")
def get_profile_activity(
	period: ProfilePeriod = Query(default="30d"),
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
	event_type: str = Query(default="", alias="eventType", max_length=80),
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	events, total = paginate_activity_events(
		db,
		user_id=user.id,
		page=page,
		page_size=page_size,
		start=_period_start(period),
		event_type=event_type.strip() or None,
	)
	return {
		"events": [_activity_event_payload(event) for event in events],
		"page": page,
		"pageSize": page_size,
		"total": total,
		"totalPages": (total + page_size - 1) // page_size,
	}


@router.get("/security")
def get_profile_security(
	user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	auth_events = list_auth_activity(db, user.id)
	last_login = latest_successful_login(db, user.id)
	return {
		"account": {
			"id": user.id,
			"login": user.login,
			"email": user.email,
			"role": parse_user_role(user.role).value,
			"createdAt": user.created_at.isoformat(),
		},
		"lastSuccessfulLoginAt": last_login.isoformat() if last_login is not None else None,
		"authEvents": [_activity_event_payload(event) for event in auth_events],
	}
