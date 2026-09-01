# Velorian Backend Instructions

These instructions apply to `backend/` together with the repository-level `GEMINI.md`.

## Actual stack and runtime

- FastAPI with Pydantic v2.
- SQLAlchemy 2 ORM with synchronous `Session` dependencies.
- SQLite for development/tests; PostgreSQL through psycopg for production.
- Groq async client for chat and vision models.
- Local filesystem storage in development; S3-compatible storage in production.
- Local document extraction through pypdf, python-docx, Pillow and optional Tesseract OCR.
- PyJWT session tokens, HttpOnly authentication cookie, and double-submit CSRF protection.
- Prometheus metrics and live/ready health endpoints.

Do not introduce another web framework, ORM, migration framework, or storage abstraction unless explicitly required.

## Current code boundaries

- `app/main.py`: application setup, middleware, exception handlers, auth, conversations, attachments, and chat streaming.
- `app/knowledge.py`: knowledge-base endpoints and persistence operations.
- `app/ratings.py`: message rating endpoints.
- `app/models.py`: SQLAlchemy models.
- `app/database.py`: engine, sessions, startup initialization.
- `app/migrations.py`: ordered custom schema migrations recorded in `schema_migrations`.
- `app/storage.py`: `FileStorage`, local storage, and S3 storage.
- `app/file_processing.py`: filename validation and local extraction/OCR.
- `app/rag.py`: conversation attachment chunking/retrieval.
- `app/knowledge_retrieval.py`: knowledge intent, filters, retrieval and diagnostics.
- `app/errors.py`: `AppError`.

There is no repository layer. Existing route modules use SQLAlchemy sessions directly. Do not claim or imitate a repository/service pattern that the project does not have. When a route becomes hard to maintain, extract focused domain functions only when the task benefits from it and tests cover the move.

## API contracts

The API prefix is `/api`. Preserve existing endpoint contracts unless the task explicitly changes them, and inspect `frontend/src/api/chatApi.ts` plus `frontend/src/types/chat.ts` before changing a response.

Normal HTTP errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "safe diagnostic message",
    "request_id": "request-id",
    "details": {}
  }
}
```

`details` is optional. Preserve the `X-Request-ID` response header and the request ID in error payloads. Use stable error codes because the frontend maps them to user-facing Russian messages.

Validate incoming IDs, enums, ratings, strings, multipart fields, file counts, per-file size, and total upload size at the backend boundary. Client validation is only an early UX check.

## Streaming

`POST /api/conversations/{conversation_id}/stream` returns `application/x-ndjson`. Each line is one event:

- `meta`: persisted user message, assistant message ID, conversation title, request ID;
- `delta`: content chunk;
- `done`: final normalized message;
- `error`: stable code, safe message, request ID.

Preserve this ordering and the frontend field names used by events. Do not convert the endpoint to SSE or buffer the entire answer without an explicit cross-stack change.

On cancellation/disconnect, persist the assistant message as `cancelled` with any partial content. Provider and application failures must persist a safe error status/code and emit an `error` event. Cancellation is scoped to the current request and must not affect other streams.

## Authentication, CSRF, and ownership

- Authentication uses the signed JWT cookie `velorian_session`, which must remain HttpOnly.
- CSRF uses the readable `velorian_csrf` cookie and `X-CSRF-Token` header for `/api` mutations.
- Registration/login rotate and return a CSRF token used by the frontend client.
- Every conversation, message, attachment, rating, approach, and knowledge query must be constrained to the authenticated user.

Never weaken cookie flags, CSRF comparison, credentialed CORS, password hashing, JWT verification, or ownership joins. Never expose tokens or secrets in responses or logs.

## Database and migrations

Use SQLAlchemy ORM/query mechanisms and parameterized `text()` statements. Never interpolate untrusted input into SQL.

For schema changes:

1. update the model where appropriate;
2. add an idempotent, versioned function to `app/migrations.py`;
3. append it to `MIGRATIONS` with a unique ordered version;
4. account for both SQLite and PostgreSQL syntax/behavior;
5. add tests for existing and newly initialized databases where practical.

Alembic is not present. Do not add more ad-hoc startup `ALTER TABLE` logic to `database.py`; use the migration registry for new changes. Never rewrite or remove an already applied migration.

Production startup requires PostgreSQL, S3 storage, S3 credentials, and a non-default `AUTH_SECRET`. Keep development/test compatibility with SQLite and local storage.

Use explicit `commit`, `flush`, and `rollback` behavior. If a database write and file-storage operation form one workflow, compensate storage on database failure and avoid orphaned objects.

## Files and storage

Treat filename, extension, MIME type, and upload metadata as untrusted. Reuse `validate_file_name`, configured limits, extraction status values, and `build_storage_key`.

Use `get_file_storage()` rather than reading or writing configured storage directly. Local and S3 operations expose an async interface and offload blocking SDK/filesystem calls with `asyncio.to_thread`.

When deleting or replacing records, preserve storage cleanup. Parsing/OCR/vision failures should degrade according to the existing behavior rather than leaking provider details or corrupting persisted metadata.

## RAG and prompt safety

Keep these concerns distinct:

- conversation document chunks: `rag.py`;
- knowledge query resolution and retrieval: `knowledge_retrieval.py`;
- knowledge CRUD/serialization: `knowledge.py`;
- prompt context construction and Groq calls: `main.py`.

Knowledge and document contents are untrusted data. Preserve the delimiters and system instructions that prevent retrieved content from becoming executable system instructions. Apply ownership, active-state, approach, metadata, and rating filters consistently.

## Async and cleanup

The project intentionally combines async FastAPI endpoints/Groq/storage with synchronous SQLAlchemy sessions. Do not pretend an async database layer exists. Avoid adding new long-running blocking filesystem, OCR, image, SDK, or CPU work directly to the event loop; follow existing `asyncio.to_thread` patterns.

Handle `asyncio.CancelledError` separately where cancellation affects persistence. Close uploads/readers, clean temporary/storage artifacts, and rollback database work on failures.

## Logging and observability

The HTTP middleware records request ID, method, route, status, and duration and exposes Prometheus metrics. Preserve low-cardinality route labels.

Log enough identifiers to diagnose failures, but never log API keys, passwords, JWTs, session/CSRF cookies, S3 credentials, full sensitive uploads, or arbitrary prompt content unnecessarily. Client responses must not contain stack traces or raw provider errors.

## Testing

Backend tests use pytest, FastAPI `TestClient`, isolated SQLite, local temporary storage, and a CSRF-aware client fixture.

```bash
cd backend
.venv/bin/pytest -q
```

For endpoint changes, cover success, validation, ownership/authentication, error shape, persistence, and cleanup. For streaming changes, cover event order, failure persistence, cancellation where practical, and the matching frontend contract. No backend lint, formatter, or static type-check script is currently configured.
