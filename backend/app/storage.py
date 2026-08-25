import asyncio
from abc import ABC, abstractmethod
from pathlib import Path, PurePosixPath
from uuid import uuid4

from .config import settings


def build_storage_key(user_id: str, category: str, *parts: str) -> str:
	segments = ("users", user_id, category, *parts, str(uuid4()))
	if any(not segment or segment in {".", ".."} or "/" in segment or "\\" in segment for segment in segments):
		raise ValueError("Unsafe storage key segment")
	return str(PurePosixPath(*segments))


class FileStorage(ABC):
	@abstractmethod
	async def save(self, key: str, content: bytes, content_type: str) -> None: ...

	@abstractmethod
	async def get(self, key: str) -> bytes: ...

	@abstractmethod
	async def delete(self, key: str) -> None: ...


class LocalFileStorage(FileStorage):
	def __init__(self, root: Path):
		self.root = root.resolve()

	def _path(self, key: str) -> Path:
		path = (self.root / PurePosixPath(key)).resolve()
		if not path.is_relative_to(self.root):
			raise ValueError("Storage key escapes configured root")
		return path

	async def save(self, key: str, content: bytes, content_type: str) -> None:
		del content_type
		path = self._path(key)
		await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
		await asyncio.to_thread(path.write_bytes, content)

	async def get(self, key: str) -> bytes:
		return await asyncio.to_thread(self._path(key).read_bytes)

	async def delete(self, key: str) -> None:
		await asyncio.to_thread(self._path(key).unlink, missing_ok=True)


class S3FileStorage(FileStorage):
	def __init__(self):
		import boto3

		self.bucket = settings.s3_bucket or ""
		self.client = boto3.client(
			"s3",
			endpoint_url=settings.s3_endpoint or None,
			region_name=settings.s3_region,
			aws_access_key_id=settings.s3_access_key,
			aws_secret_access_key=settings.s3_secret_key,
		)

	async def save(self, key: str, content: bytes, content_type: str) -> None:
		await asyncio.to_thread(self.client.put_object, Bucket=self.bucket, Key=key, Body=content, ContentType=content_type)

	async def get(self, key: str) -> bytes:
		response = await asyncio.to_thread(self.client.get_object, Bucket=self.bucket, Key=key)
		return await asyncio.to_thread(response["Body"].read)

	async def delete(self, key: str) -> None:
		await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=key)


_storage: FileStorage | None = None


def get_file_storage() -> FileStorage:
	global _storage
	if _storage is None:
		if settings.file_storage_driver == "local":
			_storage = LocalFileStorage(settings.upload_dir)
		elif settings.file_storage_driver == "s3":
			if not settings.s3_bucket or not settings.s3_access_key or not settings.s3_secret_key:
				raise RuntimeError("S3 storage requires S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY")
			_storage = S3FileStorage()
		else:
			raise RuntimeError(f"Unsupported FILE_STORAGE_DRIVER: {settings.file_storage_driver}")
	return _storage
