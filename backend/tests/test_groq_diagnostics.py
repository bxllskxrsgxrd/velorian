import json
import logging
from dataclasses import replace

import httpx
from groq import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

from app import groq_diagnostics


def _enable_debug(monkeypatch, *, app_env: str = "development") -> None:
	monkeypatch.setattr(
		groq_diagnostics,
		"settings",
		replace(groq_diagnostics.settings, app_env=app_env, groq_debug_errors=True),
	)


def _diagnostic(caplog, event: str = "GROQ_API_ERROR") -> dict:
	return next(
		json.loads(record.getMessage())
		for record in reversed(caplog.records)
		if record.name == "velorian" and record.getMessage().startswith("{")
		and json.loads(record.getMessage()).get("event") == event
	)


def test_logs_safe_413_diagnostics_with_confirmed_tpm_details(monkeypatch, caplog):
	_enable_debug(monkeypatch)
	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	response = httpx.Response(413, request=request, headers={
		"x-request-id": "provider-request-413",
		"retry-after": "2",
		"x-ratelimit-limit-tokens": "6000",
		"x-ratelimit-remaining-tokens": "120",
		"x-ratelimit-reset-tokens": "1.75s",
	})
	error = APIStatusError(
		"unsafe SDK wrapper gsk_sdk_secret",
		response=response,
		body={"error": {
			"message": (
				"Request too large in organization org_sensitive on tokens per minute (TPM): "
				"Limit: 6000, Requested: 7123, Used: 400; content: 'private echoed prompt'; "
				"Authorization: Bearer gsk_provider_secret"
			),
			"type": "tokens",
			"code": "rate_limit_exceeded",
		}},
	)
	request_options = {
		"model": "test-model",
		"messages": [
			{"role": "system", "content": "private system prompt"},
			{"role": "user", "content": "private user message"},
		],
		"max_completion_tokens": 4096,
		"stream": True,
	}

	with caplog.at_level(logging.ERROR, logger="velorian"):
		groq_diagnostics.log_groq_api_error(
			logging.getLogger("velorian"),
			error,
			purpose="chat",
			task_type="chat",
			provider="groq",
			model="test-model",
			latency_ms=123.456,
			request_options=request_options,
			correlation_id="local-correlation",
			attempt="full",
		)

	diagnostic = _diagnostic(caplog)
	assert diagnostic["http_status"] == 413
	assert diagnostic["error_type"] == "tokens"
	assert diagnostic["error_code"] == "rate_limit_exceeded"
	assert diagnostic["provider_request_id"] == "provider-request-413"
	assert diagnostic["constraint_type"] == "TPM"
	assert diagnostic["limit"] == "6000"
	assert diagnostic["requested"] == "7123"
	assert diagnostic["used"] == "400"
	assert diagnostic["max_output_tokens"] == 4096
	assert diagnostic["message_count"] == 2
	assert diagnostic["input_tokens_estimate"] > 0
	assert diagnostic["request_payload_bytes"] == groq_diagnostics.serialized_request_size(request_options)
	assert diagnostic["context_budget"] == groq_diagnostics.settings.chat_context_budget
	assert diagnostic["history_budget"] == groq_diagnostics.settings.history_token_budget
	assert diagnostic["retry-after"] == "2"
	assert diagnostic["x-ratelimit-limit-tokens"] == "6000"
	assert diagnostic["x-ratelimit-remaining-tokens"] == "120"
	assert diagnostic["x-ratelimit-reset-tokens"] == "1.75s"
	assert "private echoed prompt" not in caplog.text
	assert "private system prompt" not in caplog.text
	assert "private user message" not in caplog.text
	assert "org_sensitive" not in caplog.text
	assert "gsk_provider_secret" not in caplog.text
	assert "gsk_sdk_secret" not in caplog.text


def test_logs_429_structured_error_and_rate_limit_headers(monkeypatch, caplog):
	_enable_debug(monkeypatch)
	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	response = httpx.Response(429, request=request, headers={
		"x-request-id": "provider-request-429",
		"retry-after": "5",
		"x-ratelimit-limit-tokens": "10000",
		"x-ratelimit-remaining-tokens": "0",
		"x-ratelimit-reset-tokens": "5s",
	})
	error = RateLimitError(
		"rate limited",
		response=response,
		body={"error": {
			"message": "Token rate limit reached",
			"type": "rate_limit_error",
			"code": "rate_limit_exceeded",
		}},
	)

	with caplog.at_level(logging.ERROR, logger="velorian"):
		groq_diagnostics.log_groq_api_error(
			logging.getLogger("velorian"),
			error,
			purpose="memory_extraction",
			task_type="memory",
			provider="groq",
			model="test-model",
			latency_ms=50,
			request_options={"messages": [], "max_completion_tokens": 1024},
		)

	diagnostic = _diagnostic(caplog)
	assert diagnostic["http_status"] == 429
	assert diagnostic["error_message"] == "Token rate limit reached"
	assert diagnostic["error_type"] == "rate_limit_error"
	assert diagnostic["error_code"] == "rate_limit_exceeded"
	assert diagnostic["provider_request_id"] == "provider-request-429"
	assert diagnostic["retry-after"] == "5"
	assert diagnostic["x-ratelimit-remaining-tokens"] == "0"
	assert "input_tokens_estimate" not in diagnostic


def test_logs_connection_and_timeout_without_a_response(monkeypatch, caplog):
	_enable_debug(monkeypatch)
	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	errors = [
		APIConnectionError(message="Connection failed; Authorization: Bearer connection_secret", request=request),
		APITimeoutError(request),
	]

	with caplog.at_level(logging.ERROR, logger="velorian"):
		for error in errors:
			groq_diagnostics.log_groq_api_error(
				logging.getLogger("velorian"),
				error,
				purpose="chat",
				task_type="chat",
				provider="groq",
				model="test-model",
				latency_ms=90,
				request_options={"messages": []},
			)

	diagnostics = [
		json.loads(record.getMessage())
		for record in caplog.records
		if record.name == "velorian" and record.getMessage().startswith("{")
	]
	assert [item["exception_type"] for item in diagnostics] == ["APIConnectionError", "APITimeoutError"]
	assert all(item["http_status"] is None for item in diagnostics)
	assert diagnostics[0]["error_message"] == "Connection failed; Authorization=[redacted]"
	assert diagnostics[1]["error_message"] == "Request timed out."
	assert "connection_secret" not in caplog.text


def test_detailed_diagnostics_are_disabled_outside_development(monkeypatch, caplog):
	_enable_debug(monkeypatch, app_env="production")
	request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
	error = APIConnectionError(message="must not be logged", request=request)

	with caplog.at_level(logging.ERROR, logger="velorian"):
		groq_diagnostics.log_groq_api_error(
			logging.getLogger("velorian"),
			error,
			purpose="chat",
			task_type="chat",
			provider="groq",
			model="test-model",
			latency_ms=1,
		)

	assert "must not be logged" not in caplog.text
	assert not caplog.records
