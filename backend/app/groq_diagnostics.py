from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping
from typing import Any

from groq import APIConnectionError, APIError, APIStatusError, APITimeoutError

from .config import settings
from .rag import estimate_tokens


GROQ_DIAGNOSTIC_ERRORS = (APIStatusError, APIConnectionError, APITimeoutError)
_SECRET_PATTERNS = (
	re.compile(r"\b(?:gsk|sk)[_-][A-Za-z0-9_-]+", re.IGNORECASE),
	re.compile(
		r"(?i)\b(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|set-cookie)"
		r"\s*[:=]\s*(?:Bearer\s+)?([^\s,;]+)"
	),
	re.compile(r"\borg[-_][A-Za-z0-9_-]+", re.IGNORECASE),
	re.compile(r"(?i)\b(organization(?:\s+(?:id|identifier))?)\s*[:=]?\s+[A-Za-z0-9][A-Za-z0-9_-]{5,}"),
	re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
)
_SENSITIVE_FIELD_PATTERN = re.compile(
	r'''(?is)(["']?(?:content|prompt|summary|memory|messages?|input|value|data|file|authorization|cookie)["']?\s*[:=]\s*)(["'])(.*?)(\2)'''
)


def groq_debug_errors_enabled() -> bool:
	return settings.app_env == "development" and settings.groq_debug_errors


def is_groq_diagnostic_error(error: BaseException) -> bool:
	return isinstance(error, GROQ_DIAGNOSTIC_ERRORS)


def is_groq_provider_error(error: BaseException) -> bool:
	return isinstance(error, APIError)


def _safe_provider_text(value: object, *, maximum_length: int = 2000) -> str | None:
	if value is None:
		return None
	text = " ".join(str(value).split())
	text = _SENSITIVE_FIELD_PATTERN.sub(r"\1\2[redacted]\2", text)
	for pattern in _SECRET_PATTERNS:
		if pattern.groups:
			text = pattern.sub(lambda match: f"{match.group(1)}=[redacted]", text)
		else:
			text = pattern.sub("[redacted]", text)
	if len(text) > maximum_length:
		text = text[:maximum_length] + "…[truncated]"
	return text


def _error_object(error: BaseException) -> object | None:
	body = getattr(error, "body", None)
	if isinstance(body, Mapping) and "error" in body:
		return body.get("error")
	structured_error = getattr(body, "error", None)
	if structured_error is not None:
		return structured_error
	return body


def _error_field(error_object: object, field: str) -> object | None:
	if isinstance(error_object, Mapping):
		return error_object.get(field)
	return getattr(error_object, field, None)


def _response_headers(value: object) -> object | None:
	response = getattr(value, "response", value)
	return getattr(response, "headers", None)


def provider_request_id(value: object) -> str | None:
	direct = getattr(value, "request_id", None)
	if direct:
		return _safe_provider_text(direct, maximum_length=256)
	headers = _response_headers(value)
	if headers is None:
		return None
	for name in ("x-request-id", "request-id"):
		request_id = headers.get(name)
		if request_id:
			return _safe_provider_text(request_id, maximum_length=256)
	return None


def _header_value(error: BaseException, name: str) -> str | None:
	headers = _response_headers(error)
	if headers is None:
		return None
	return _safe_provider_text(headers.get(name), maximum_length=256)


def groq_error_metadata(error: BaseException) -> dict[str, object | None]:
	error_object = _error_object(error)
	structured_message = _error_field(error_object, "message")
	if structured_message is None and isinstance(error_object, str):
		structured_message = error_object
	return {
		"http_status": getattr(error, "status_code", None),
		"exception_type": type(error).__name__,
		"error_type": _safe_provider_text(_error_field(error_object, "type"), maximum_length=256),
		"error_code": _safe_provider_text(_error_field(error_object, "code"), maximum_length=256),
		"error_message": _safe_provider_text(structured_message or getattr(error, "message", None)),
		"provider_request_id": provider_request_id(error),
	}


def _message_text_tokens(content: object) -> int:
	if isinstance(content, str):
		return estimate_tokens(content)
	if not isinstance(content, list):
		return 0
	total = 0
	for part in content:
		if isinstance(part, Mapping):
			text = part.get("text")
			if isinstance(text, str):
				total += estimate_tokens(text)
	return total


def estimate_request_input_tokens(request_options: Mapping[str, Any] | None) -> int | None:
	if request_options is None:
		return None
	messages = request_options.get("messages")
	if not isinstance(messages, list):
		return None
	return sum(
		_message_text_tokens(message.get("content"))
		for message in messages
		if isinstance(message, Mapping)
	)


def serialized_request_size(request_options: Mapping[str, Any] | None) -> int | None:
	if request_options is None:
		return None
	try:
		encoder = json.JSONEncoder(
			ensure_ascii=False,
			separators=(",", ":"),
			default=lambda value: f"<{type(value).__name__}>",
		)
		return sum(len(chunk.encode("utf-8")) for chunk in encoder.iterencode(request_options))
	except (TypeError, ValueError, RecursionError):
		return None


def _find_named_value(value: object, field: str) -> object | None:
	if isinstance(value, Mapping):
		for key, item in value.items():
			if str(key).lower() == field:
				return item
		for item in value.values():
			found = _find_named_value(item, field)
			if found is not None:
				return found
	elif isinstance(value, list):
		for item in value:
			found = _find_named_value(item, field)
			if found is not None:
				return found
	return None


def _limit_values(error: BaseException) -> dict[str, object | None]:
	error_object = _error_object(error)
	message = _error_field(error_object, "message") or getattr(error, "message", "")
	values: dict[str, object | None] = {}
	for field in ("limit", "requested", "used"):
		value = _find_named_value(error_object, field)
		if value is None:
			match = re.search(
				rf"\b{field}\s*[:=]\s*([0-9][0-9_]*(?:,[0-9]{{3}})*(?:\.[0-9]+)?)",
				str(message),
				re.IGNORECASE,
			)
			value = match.group(1) if match else None
		values[field] = _safe_provider_text(value, maximum_length=128)
	return values


def _constraint_type(error: BaseException) -> str:
	error_object = _error_object(error)
	try:
		response_evidence = json.dumps(error_object, ensure_ascii=False, default=str)
	except (TypeError, ValueError, RecursionError):
		response_evidence = str(error_object or "")
	evidence = response_evidence.casefold()
	if re.search(r"\btpm\b|tokens? per minute|token rate limit", evidence):
		return "TPM"
	if re.search(r"context[_ -]?length|context window|maximum context|max(?:imum)? context|context token", evidence):
		return "context"
	if re.search(r"payload|request body|body size|request size|content[- ]length|entity too large", evidence):
		return "payload"
	return "unknown"


def _max_output_tokens(request_options: Mapping[str, Any] | None) -> object | None:
	if request_options is None:
		return None
	return request_options.get("max_completion_tokens", request_options.get("max_tokens"))


def _message_count(request_options: Mapping[str, Any] | None) -> int | None:
	if request_options is None:
		return None
	messages = request_options.get("messages")
	return len(messages) if isinstance(messages, list) else None


def log_groq_api_error(
	logger: logging.Logger,
	error: BaseException,
	*,
	purpose: str,
	task_type: str,
	provider: str,
	model: str,
	latency_ms: float,
	request_options: Mapping[str, Any] | None = None,
	correlation_id: str | None = None,
	attempt: str | None = None,
) -> None:
	if not groq_debug_errors_enabled() or not is_groq_diagnostic_error(error):
		return
	diagnostic: dict[str, object | None] = {
		"event": "GROQ_API_ERROR",
		"correlation_id": correlation_id,
		"attempt": attempt,
		**groq_error_metadata(error),
		"provider": provider,
		"model": model,
		"purpose": purpose,
		"task_type": task_type,
		"latency_ms": round(latency_ms, 2),
		"retry-after": _header_value(error, "retry-after"),
		"x-ratelimit-limit-tokens": _header_value(error, "x-ratelimit-limit-tokens"),
		"x-ratelimit-remaining-tokens": _header_value(error, "x-ratelimit-remaining-tokens"),
		"x-ratelimit-reset-tokens": _header_value(error, "x-ratelimit-reset-tokens"),
	}
	if getattr(error, "status_code", None) == 413:
		diagnostic.update({
			"input_tokens_estimate": estimate_request_input_tokens(request_options),
			"max_output_tokens": _max_output_tokens(request_options),
			"context_budget": settings.chat_context_budget,
			"max_input_tokens": settings.max_input_tokens,
			"history_budget": settings.history_token_budget,
			"message_count": _message_count(request_options),
			"request_payload_bytes": serialized_request_size(request_options),
			**_limit_values(error),
			"constraint_type": _constraint_type(error),
		})
	logger.error(json.dumps(diagnostic, ensure_ascii=False, sort_keys=True))


def log_compact_fallback_started(
	logger: logging.Logger,
	*,
	correlation_id: str,
	error: BaseException,
	full_request_options: Mapping[str, Any],
	compact_request_options: Mapping[str, Any],
	reason: str,
) -> None:
	if not groq_debug_errors_enabled():
		return
	logger.warning(json.dumps({
		"event": "GROQ_COMPACT_FALLBACK_STARTED",
		"correlation_id": correlation_id,
		"reason": reason,
		"full_input_tokens_estimate": estimate_request_input_tokens(full_request_options),
		"compact_input_tokens_estimate": estimate_request_input_tokens(compact_request_options),
		"initial_provider_request_id": provider_request_id(error),
		"initial_http_status": getattr(error, "status_code", None),
	}, ensure_ascii=False, sort_keys=True))


def log_compact_fallback_result(
	logger: logging.Logger,
	*,
	correlation_id: str,
	result: str,
	latency_ms: float,
	provider_request_id_value: str | None = None,
	error: BaseException | None = None,
) -> None:
	if not groq_debug_errors_enabled():
		return
	payload: dict[str, object | None] = {
		"event": "GROQ_COMPACT_FALLBACK_RESULT",
		"correlation_id": correlation_id,
		"result": result,
		"latency_ms": round(latency_ms, 2),
		"provider_request_id": provider_request_id_value or (provider_request_id(error) if error else None),
	}
	if error is not None:
		metadata = groq_error_metadata(error)
		payload.update({
			"http_status": metadata["http_status"],
			"error_type": metadata["error_type"],
			"error_code": metadata["error_code"],
			"error_message": metadata["error_message"],
		})
	logger.log(logging.WARNING if result == "success" else logging.ERROR, json.dumps(payload, ensure_ascii=False, sort_keys=True))
