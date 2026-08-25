import os
import shutil
import tempfile


TEST_DIR = tempfile.mkdtemp(prefix="velorian-tests-")
os.environ["APP_ENV"] = "test"
os.environ["AUTH_SECRET"] = "test-secret-that-is-long-enough-for-tests"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DIR}/test.db"
os.environ["UPLOAD_DIR"] = f"{TEST_DIR}/uploads"
os.environ["GROQ_API_KEY"] = "test-key"
os.environ["RATE_LIMIT_REQUESTS"] = "1000"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import engine


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_files():
	yield
	engine.dispose()
	shutil.rmtree(TEST_DIR, ignore_errors=True)


@pytest.fixture
def client():
	with TestClient(app) as test_client:
		csrf = test_client.get("/api/auth/csrf").json()["csrfToken"]
		test_client.headers.update({"X-CSRF-Token": csrf})
		yield test_client


@pytest.fixture
def authenticated_client(client):
	response = client.post(
		"/api/auth/register",
		json={"email": f"user-{os.urandom(5).hex()}@example.com", "password": "strong-password"},
	)
	assert response.status_code == 200
	client.headers.update({"X-CSRF-Token": response.json()["csrfToken"]})
	return client
