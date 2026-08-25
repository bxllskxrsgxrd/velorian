import asyncio
from pathlib import Path

import pytest

from app.config import Settings
from app.storage import LocalFileStorage, S3FileStorage, build_storage_key


def test_local_file_storage_roundtrip_and_safe_keys(tmp_path: Path):
	storage = LocalFileStorage(tmp_path)
	key = build_storage_key("user-1", "knowledge", "item-1")
	asyncio.run(storage.save(key, b"private data", "text/plain"))
	assert asyncio.run(storage.get(key)) == b"private data"
	asyncio.run(storage.delete(key))
	assert not (tmp_path / key).exists()
	with pytest.raises(ValueError):
		build_storage_key("../other", "knowledge")


def test_s3_storage_uses_private_object_operations():
	class FakeClient:
		def __init__(self): self.objects = {}
		def put_object(self, **kwargs): self.objects[kwargs["Key"]] = kwargs["Body"]
		def get_object(self, **kwargs):
			class Body:
				def __init__(self, value): self.value = value
				def read(self): return self.value
			return {"Body": Body(self.objects[kwargs["Key"]])}
		def delete_object(self, **kwargs): self.objects.pop(kwargs["Key"], None)

	storage = object.__new__(S3FileStorage)
	storage.bucket = "private"
	storage.client = FakeClient()
	asyncio.run(storage.save("users/u/knowledge/key", b"data", "text/plain"))
	assert asyncio.run(storage.get("users/u/knowledge/key")) == b"data"
	asyncio.run(storage.delete("users/u/knowledge/key"))
	assert storage.client.objects == {}


def test_production_configuration_requires_postgres_and_s3():
	with pytest.raises(RuntimeError, match="PostgreSQL"):
		Settings(app_env="production", database_url="sqlite:///bad.db", file_storage_driver="s3", s3_bucket="bucket", s3_access_key="key", s3_secret_key="secret").validate_production()
	with pytest.raises(RuntimeError, match="FILE_STORAGE_DRIVER"):
		Settings(app_env="production", database_url="postgresql+psycopg://localhost/db", file_storage_driver="local").validate_production()
	Settings(app_env="production", database_url="postgresql+psycopg://localhost/db", file_storage_driver="s3", s3_bucket="bucket", s3_access_key="key", s3_secret_key="secret").validate_production()
