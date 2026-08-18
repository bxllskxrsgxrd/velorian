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
	max_input_tokens: int = int(os.getenv("MAX_INPUT_TOKENS", "100000"))
	max_output_tokens: int = int(os.getenv("MAX_OUTPUT_TOKENS", "4096"))
	rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
	rate_limit_window_seconds: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
	ocr_languages: str = os.getenv("OCR_LANGUAGES", "rus+eng")

	@property
	def is_production(self) -> bool:
		return self.app_env == "production"


settings = Settings()
