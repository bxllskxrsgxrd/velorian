import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _as_bool(value: str | None, default: bool = False) -> bool:
	if value is None:
		return default
	return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_origins(value: str | None) -> tuple[str, ...]:
	if not value:
		return (
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"http://localhost:5174",
			"http://127.0.0.1:5174",
		)
	return tuple(origin.strip() for origin in value.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
	app_env: str = os.getenv("APP_ENV", "development")
	app_name: str = "Velorian API"
	api_prefix: str = "/api"
	groq_api_key: str | None = os.getenv("GROQ_API_KEY")
	groq_model: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
	groq_vision_model: str = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.6-27b")
	groq_debug_errors: bool = _as_bool(os.getenv("GROQ_DEBUG_ERRORS"), False)
	enable_vision: bool = _as_bool(os.getenv("ENABLE_VISION"), True)
	database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'velorian.db'}")
	auth_secret: str = os.getenv("AUTH_SECRET", "velorian-development-secret-change-me")
	cookie_secure: bool = _as_bool(os.getenv("COOKIE_SECURE"), os.getenv("APP_ENV") == "production")
	allow_registration: bool = _as_bool(os.getenv("ALLOW_REGISTRATION"), True)
	cors_origins: tuple[str, ...] = _as_origins(os.getenv("CORS_ORIGINS"))
	upload_dir: Path = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
	max_files: int = int(os.getenv("MAX_FILES", "10"))
	max_file_size: int = int(os.getenv("MAX_FILE_SIZE", str(10 * 1024 * 1024)))
	max_total_file_size: int = int(os.getenv("MAX_TOTAL_FILE_SIZE", str(25 * 1024 * 1024)))
	user_message_inline_char_limit: int = int(os.getenv("USER_MESSAGE_INLINE_CHAR_LIMIT", "12000"))
	max_input_tokens: int = int(os.getenv("MAX_INPUT_TOKENS", "100000"))
	chat_context_budget: int = int(os.getenv("CHAT_CONTEXT_BUDGET", "100000"))
	history_token_budget: int = int(os.getenv("HISTORY_TOKEN_BUDGET", "72000"))
	max_output_tokens: int = int(os.getenv("MAX_OUTPUT_TOKENS", "4096"))
	rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
	rate_limit_window_seconds: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
	ocr_languages: str = os.getenv("OCR_LANGUAGES", "rus+eng")
	knowledge_rating_threshold: int = int(os.getenv("KNOWLEDGE_RATING_THRESHOLD", "4"))
	knowledge_search_driver: str = os.getenv("KNOWLEDGE_SEARCH_DRIVER", "text").strip().lower()
	file_storage_driver: str = os.getenv("FILE_STORAGE_DRIVER", "local").strip().lower()
	s3_endpoint: str | None = os.getenv("S3_ENDPOINT")
	s3_region: str = os.getenv("S3_REGION", "us-east-1")
	s3_bucket: str | None = os.getenv("S3_BUCKET")
	s3_access_key: str | None = os.getenv("S3_ACCESS_KEY")
	s3_secret_key: str | None = os.getenv("S3_SECRET_KEY")
	database_pool_size: int = int(os.getenv("DATABASE_POOL_SIZE", "10"))
	database_max_overflow: int = int(os.getenv("DATABASE_MAX_OVERFLOW", "20"))

	@property
	def is_production(self) -> bool:
		return self.app_env == "production"

	def validate_production(self) -> None:
		if not self.is_production:
			return
		if self.database_url.startswith("sqlite"):
			raise RuntimeError("Production requires PostgreSQL DATABASE_URL; SQLite is allowed only for development and tests")
		if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
			raise RuntimeError("Production DATABASE_URL must use PostgreSQL")
		if self.file_storage_driver != "s3":
			raise RuntimeError("Production requires FILE_STORAGE_DRIVER=s3")
		missing = [name for name, value in {
			"S3_BUCKET": self.s3_bucket,
			"S3_ACCESS_KEY": self.s3_access_key,
			"S3_SECRET_KEY": self.s3_secret_key,
		}.items() if not value]
		if missing:
			raise RuntimeError(f"Missing production object storage settings: {', '.join(missing)}")


settings = Settings()
