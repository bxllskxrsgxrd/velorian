import threading
import time
from collections import defaultdict, deque

from .config import settings
from .errors import AppError


class SlidingWindowRateLimiter:
	def __init__(self, max_requests: int, window_seconds: int):
		self.max_requests = max_requests
		self.window_seconds = window_seconds
		self._events: dict[str, deque[float]] = defaultdict(deque)
		self._lock = threading.Lock()
		self._checks = 0

	def check(self, key: str) -> None:
		now = time.monotonic()
		threshold = now - self.window_seconds
		with self._lock:
			self._checks += 1
			if self._checks % 256 == 0:
				stale_keys = [event_key for event_key, queued in self._events.items() if not queued or queued[-1] <= threshold]
				for stale_key in stale_keys:
					del self._events[stale_key]
			events = self._events[key]
			while events and events[0] <= threshold:
				events.popleft()
			if len(events) >= self.max_requests:
				retry_after = max(1, round(events[0] + self.window_seconds - now))
				raise AppError(429, "RATE_LIMITED", f"Слишком много запросов. Повторите через {retry_after} сек.")
			events.append(now)


rate_limiter = SlidingWindowRateLimiter(settings.rate_limit_requests, settings.rate_limit_window_seconds)
