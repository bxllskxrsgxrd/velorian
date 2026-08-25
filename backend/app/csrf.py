import secrets

from fastapi import Request, Response

from .config import settings
from .errors import AppError


CSRF_COOKIE_NAME = "velorian_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_TOKEN_BYTES = 32
CSRF_COOKIE_MAX_AGE = 14 * 24 * 60 * 60
MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def create_csrf_token() -> str:
	return secrets.token_urlsafe(CSRF_TOKEN_BYTES)


def set_csrf_cookie(response: Response, token: str) -> None:
	response.set_cookie(
		CSRF_COOKIE_NAME,
		token,
		httponly=False,
		secure=settings.cookie_secure,
		samesite="lax",
		max_age=CSRF_COOKIE_MAX_AGE,
		path="/",
	)


def issue_csrf_token(request: Request, response: Response, *, rotate: bool = False) -> str:
	existing = request.cookies.get(CSRF_COOKIE_NAME)
	token = create_csrf_token() if rotate or not existing else existing
	set_csrf_cookie(response, token)
	return token


def verify_csrf(request: Request) -> None:
	if request.method not in MUTATION_METHODS or not request.url.path.startswith(settings.api_prefix):
		return
	cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
	header_token = request.headers.get(CSRF_HEADER_NAME)
	if not cookie_token or not header_token or not secrets.compare_digest(cookie_token, header_token):
		raise AppError(403, "CSRF_INVALID", "Защитный токен запроса недействителен. Обновите страницу и повторите действие.")
