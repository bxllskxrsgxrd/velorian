from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Mapping
from datetime import datetime
from decimal import Decimal, InvalidOperation
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal
from .models import AIUsageEvent, ActivityEvent, utc_now


structured_logger = logging.getLogger("velorian.observability")
structured_logger.setLevel(logging.INFO)

_HANDLER_MARKER = "_velorian_observability_handler"
_pending_writes: set[asyncio.Task[Any]] = set()
_SAFE_TECHNICAL_FIELDS = {
	"correlation_id", "user_id", "endpoint", "purpose", "provider", "model", "status",
	"error_code", "latency_ms", "task_type", "prompt_version", "attempt", "phase", "result",
	"input_tokens", "output_tokens", "cached_tokens", "total_tokens", "message_count",
	"summary_tokens", "memory_tokens", "history_tokens", "system_tokens", "user_tokens",
}


def configure_observability_logging(
	path: Path | None = None,
	*,
	max_bytes: int | None = None,
	backup_count: int | None = None,
) -> Path:
	log_path = Path(path or settings.observability_log_path)
	log_path.parent.mkdir(parents=True, exist_ok=True)
	handler = RotatingFileHandler(
		log_path,
		maxBytes=max(1, max_bytes if max_bytes is not None else settings.observability_log_max_bytes),
		backupCount=max(0, backup_count if backup_count is not None else settings.observability_log_backup_count),
		encoding="utf-8",
	)
	setattr(handler, _HANDLER_MARKER, True)
	handler.setFormatter(logging.Formatter("%(message)s"))
	for current_handler in list(structured_logger.handlers):
		if getattr(current_handler, _HANDLER_MARKER, False):
			structured_logger.removeHandler(current_handler)
			current_handler.close()
	structured_logger.addHandler(handler)
	return log_path


def log_technical_event(level: str, event: str, **fields: object) -> None:
	payload: dict[str, object] = {
		"timestamp": utc_now().isoformat(),
		"level": level.upper(),
		"event": event,
	}
	for key, value in fields.items():
		if key not in _SAFE_TECHNICAL_FIELDS or value is None:
			continue
		if isinstance(value, str):
			payload[key] = value[:256]
		elif isinstance(value, (int, float, bool)):
			payload[key] = value
	log_method = getattr(structured_logger, level.lower(), structured_logger.info)
	log_method(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def _pricing_config(value: str | Mapping[str, object] | None = None) -> Mapping[str, object]:
	if isinstance(value, Mapping):
		return value
	raw = settings.ai_pricing_json if value is None else value
	try:
		parsed = json.loads(raw)
		return parsed if isinstance(parsed, Mapping) else {}
	except (TypeError, json.JSONDecodeError):
		return {}


def _rate(value: object) -> Decimal | None:
	try:
		rate = Decimal(str(value))
	except (InvalidOperation, TypeError, ValueError):
		return None
	return rate if rate >= 0 else None


def estimate_ai_cost_usd(
	*,
	provider: str,
	model: str,
	input_tokens: int | None,
	output_tokens: int | None,
	cached_tokens: int | None,
	pricing: str | Mapping[str, object] | None = None,
) -> Decimal | None:
	if input_tokens is None or output_tokens is None:
		return None
	provider_prices = _pricing_config(pricing).get(provider)
	if not isinstance(provider_prices, Mapping):
		return None
	model_prices = provider_prices.get(model)
	if not isinstance(model_prices, Mapping):
		return None
	input_rate = _rate(model_prices.get("input_per_million_usd"))
	output_rate = _rate(model_prices.get("output_per_million_usd"))
	if input_rate is None or output_rate is None:
		return None
	cached_rate = _rate(model_prices.get("cached_input_per_million_usd"))
	input_cost_tokens = max(input_tokens, 0)
	cost = Decimal(input_cost_tokens) * input_rate
	if cached_rate is not None and cached_tokens is not None:
		cached = min(max(cached_tokens, 0), input_cost_tokens)
		cost = Decimal(input_cost_tokens - cached) * input_rate + Decimal(cached) * cached_rate
	cost += Decimal(max(output_tokens, 0)) * output_rate
	return (cost / Decimal(1_000_000)).quantize(Decimal("0.00000001"))


def record_ai_usage_event(
	*,
	event_id: str,
	user_id: str | None,
	conversation_id: str | None,
	correlation_id: str | None,
	purpose: str,
	task_type: str,
	provider: str,
	model: str,
	prompt_version: str,
	reasoning_effort: str | None,
	status: str,
	input_tokens: int | None,
	output_tokens: int | None,
	cached_tokens: int | None,
	latency_ms: float,
	pricing: str | Mapping[str, object] | None = None,
) -> bool:
	total_tokens = input_tokens + output_tokens if input_tokens is not None and output_tokens is not None else None
	cost = estimate_ai_cost_usd(
		provider=provider,
		model=model,
		input_tokens=input_tokens,
		output_tokens=output_tokens,
		cached_tokens=cached_tokens,
		pricing=pricing,
	)
	with SessionLocal() as db:
		try:
			if db.get(AIUsageEvent, event_id) is not None:
				return False
			db.add(AIUsageEvent(
				id=event_id,
				user_id=user_id,
				conversation_id=conversation_id,
				correlation_id=correlation_id[:128] if correlation_id else None,
				purpose=purpose,
				task_type=task_type,
				provider=provider,
				model=model,
				prompt_version=prompt_version,
				reasoning_effort=reasoning_effort,
				status=status,
				input_tokens=input_tokens,
				output_tokens=output_tokens,
				cached_tokens=cached_tokens,
				total_tokens=total_tokens,
				latency_ms=latency_ms,
				estimated_cost_usd=cost,
			))
			db.commit()
			return True
		except IntegrityError:
			db.rollback()
			return False
		except Exception as error:
			db.rollback()
			log_technical_event(
				"error",
				"AI_USAGE_PERSIST_FAILED",
				correlation_id=correlation_id,
				user_id=user_id,
				purpose=purpose,
				provider=provider,
				model=model,
				status="error",
				error_code=type(error).__name__,
			)
			return False


def record_activity_event(
	*,
	user_id: str | None,
	event_type: str,
	resource_type: str,
	resource_id: str | None = None,
	status: str = "success",
	correlation_id: str | None = None,
) -> bool:
	with SessionLocal() as db:
		try:
			db.add(ActivityEvent(
				user_id=user_id,
				event_type=event_type,
				resource_type=resource_type,
				resource_id=resource_id,
				status=status,
				correlation_id=correlation_id[:128] if correlation_id else None,
			))
			db.commit()
			return True
		except Exception as error:
			db.rollback()
			log_technical_event(
				"error",
				"ACTIVITY_EVENT_PERSIST_FAILED",
				correlation_id=correlation_id,
				user_id=user_id,
				status="error",
				error_code=type(error).__name__,
			)
			return False


def _defer(callback: Callable[..., object], **kwargs: object) -> None:
	try:
		loop = asyncio.get_running_loop()
	except RuntimeError:
		callback(**kwargs)
		return
	task = loop.create_task(asyncio.to_thread(callback, **kwargs))
	_pending_writes.add(task)
	task.add_done_callback(_pending_writes.discard)


def defer_ai_usage_event(**kwargs: object) -> None:
	_defer(record_ai_usage_event, **kwargs)


def defer_activity_event(**kwargs: object) -> None:
	_defer(record_activity_event, **kwargs)


async def drain_observability_writes() -> None:
	if _pending_writes:
		await asyncio.gather(*tuple(_pending_writes), return_exceptions=True)


def summarize_ai_usage(
	db: Session,
	*,
	user_id: str | None = None,
	model: str | None = None,
	status: str | None = None,
	start: datetime | None = None,
	end: datetime | None = None,
) -> dict[str, object]:
	filters = []
	if user_id is not None:
		filters.append(AIUsageEvent.user_id == user_id)
	if model is not None:
		filters.append(AIUsageEvent.model == model)
	if status is not None:
		filters.append(AIUsageEvent.status == status)
	if start is not None:
		filters.append(AIUsageEvent.created_at >= start)
	if end is not None:
		filters.append(AIUsageEvent.created_at < end)
	row = db.execute(select(
		func.count(AIUsageEvent.id),
		func.sum(AIUsageEvent.input_tokens),
		func.sum(AIUsageEvent.output_tokens),
		func.sum(AIUsageEvent.estimated_cost_usd),
	).where(*filters)).one()
	return {
		"request_count": row[0],
		"input_tokens": row[1],
		"output_tokens": row[2],
		"estimated_cost_usd": row[3],
	}


def list_activity_history(db: Session, user_id: str, *, limit: int = 100) -> list[ActivityEvent]:
	return list(db.scalars(
		select(ActivityEvent)
		.where(ActivityEvent.user_id == user_id)
		.order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
		.limit(min(max(limit, 1), 500))
	))


def technical_events_by_correlation_id(
	correlation_id: str,
	*,
	path: Path | None = None,
	backup_count: int | None = None,
) -> list[dict[str, Any]]:
	log_path = Path(path or settings.observability_log_path)
	archives = max(0, backup_count if backup_count is not None else settings.observability_log_backup_count)
	result: list[dict[str, Any]] = []
	for candidate in [log_path, *(Path(f"{log_path}.{index}") for index in range(1, archives + 1))]:
		if not candidate.exists():
			continue
		for line in candidate.read_text(encoding="utf-8").splitlines():
			try:
				payload = json.loads(line)
			except json.JSONDecodeError:
				continue
			if isinstance(payload, dict) and payload.get("correlation_id") == correlation_id:
				result.append(payload)
	return result
