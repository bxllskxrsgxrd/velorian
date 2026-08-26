from dataclasses import dataclass


@dataclass
class AppError(Exception):
	status_code: int
	code: str
	message: str
	details: dict | None = None

	def __str__(self) -> str:
		return self.message
