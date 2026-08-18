import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Cookie, Depends
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .errors import AppError
from .models import User


COOKIE_NAME = "velorian_session"
TOKEN_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 14


def normalize_email(email: str) -> str:
	return email.strip().lower()


def hash_password(password: str) -> str:
	salt = os.urandom(16)
	derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
	return f"scrypt${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(derived).decode()}"


def verify_password(password: str, encoded: str) -> bool:
	try:
		algorithm, salt_encoded, hash_encoded = encoded.split("$", 2)
		if algorithm != "scrypt":
			return False
		salt = base64.urlsafe_b64decode(salt_encoded)
		expected = base64.urlsafe_b64decode(hash_encoded)
		actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
		return hmac.compare_digest(actual, expected)
	except (ValueError, TypeError):
		return False


def create_session_token(user_id: str) -> str:
	now = datetime.now(timezone.utc)
	payload = {"sub": user_id, "iat": now, "exp": now + timedelta(days=TOKEN_TTL_DAYS)}
	return jwt.encode(payload, settings.auth_secret, algorithm=TOKEN_ALGORITHM)


def get_current_user(
	session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
	db: Session = Depends(get_db),
) -> User:
	if not session_token:
		raise AppError(401, "AUTH_REQUIRED", "Необходимо войти в аккаунт")

	try:
		payload = jwt.decode(session_token, settings.auth_secret, algorithms=[TOKEN_ALGORITHM])
		user_id = payload.get("sub")
		if not isinstance(user_id, str):
			raise InvalidTokenError("Missing subject")
	except InvalidTokenError as error:
		raise AppError(401, "INVALID_SESSION", "Сессия истекла, войдите снова") from error

	user = db.get(User, user_id)
	if user is None:
		raise AppError(401, "INVALID_SESSION", "Сессия недействительна")
	return user
