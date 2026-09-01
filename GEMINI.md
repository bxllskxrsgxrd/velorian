# Velorian — Project Instructions

## Scope and instruction hierarchy

This file applies to the whole repository. More specific instructions are in:

- `backend/GEMINI.md` for `backend/`;
- `frontend/GEMINI.md` for `frontend/`.

When working in a subdirectory, follow both this file and the matching local file. The local file is authoritative for implementation details in that area.

## What the project is

Velorian is a full-stack, local-first AI chat application built around Groq models.

- `frontend/`: React 19, TypeScript, Vite, SCSS, React Router, Zustand.
- `backend/`: FastAPI, Pydantic, SQLAlchemy, Groq SDK.
- Development/test persistence: SQLite and local file storage.
- Production persistence: PostgreSQL and S3-compatible object storage; production validation rejects SQLite and local storage.
- Features: cookie authentication, CSRF protection, persistent conversations, NDJSON AI streaming, retry/edit branches, attachments, OCR/vision processing, lexical conversation RAG, user knowledge base, ratings, generated files, Markdown rendering, metrics and health checks.

Changes to API payloads, streaming events, authentication, files, or persisted models usually require inspecting both applications.

## Actual architecture

Do not assume layers that do not exist.

- Backend auth, conversations, attachments, and chat streaming currently live mainly in `backend/app/main.py`.
- Knowledge and ratings use `APIRouter` modules in `backend/app/knowledge.py` and `backend/app/ratings.py`.
- SQLAlchemy models and sessions are in `backend/app/models.py` and `backend/app/database.py`.
- Schema evolution uses the custom registry in `backend/app/migrations.py`; Alembic is not installed.
- File storage is abstracted by `backend/app/storage.py` with local and S3 implementations.
- Frontend API access is centralized in `frontend/src/api/httpClient.ts` and `frontend/src/api/chatApi.ts`.
- Frontend state is split across independent domain stores in `frontend/src/stores/`.
- `ChatPage.tsx` and `KnowledgePage.tsx` remain large orchestration components. Preserve their behavior during targeted changes; extract orchestration only as an intentional, separately verified refactor.

Follow existing boundaries before adding new ones. Do not invent a repository, service, Context, or global store layer merely to satisfy a generic architecture pattern.

## Working method

Before modifying code:

1. Inspect the current implementation and relevant tests.
2. Trace the data flow through UI, store, API client, endpoint, database, and storage where applicable.
3. Identify contracts and cleanup responsibilities.
4. Preserve current behavior unless the task explicitly changes it.
5. Make the smallest coherent change that fixes the root cause.
6. Reuse existing types, helpers, stores, error codes, and UI primitives.
7. Run the existing checks relevant to the change.

Do not rewrite working code speculatively or mix an unrelated refactor into a bug fix.

## Cross-application contracts

Frontend and backend must agree on:

- endpoint and HTTP method;
- JSON or multipart field names;
- response shape and camelCase/snake_case normalization;
- nullable fields and enum-like values;
- IDs and ownership rules;
- error codes and `request_id` propagation;
- streaming event order and fields;
- attachment limits and status values.

The backend error envelope is structured and the frontend maps its codes to safe user-facing messages. Do not return arbitrary error shapes or show raw provider/backend messages to users.

The chat stream is `application/x-ndjson`, one JSON object per line, with `meta`, `delta`, `done`, and `error` events. It is not an SSE protocol.

## State and concurrency

The frontend uses independent Zustand stores rather than a Redux-style root store. Stores must remain separated by domain and must not import one another unless there is a demonstrated need. Prefer orchestration in components/hooks/services for cross-domain workflows.

The current frontend product model permits one active foreground generation in `ChatPage`. Selecting another conversation intentionally aborts that active browser request before navigation. Do not describe or redesign this as concurrent per-conversation frontend streaming without an explicit product change and corresponding store/API work.

Backend request cancellation remains request-scoped: cancellation or disconnect of one stream must not affect another user's or conversation's stream.

Guard against stale async results when routes or conversations change. Preserve the existing load sequencing, optimistic message replacement, request IDs, and cancellation cleanup.

## Persistence and destructive operations

Before changing persisted data:

1. inspect SQLAlchemy models;
2. inspect `backend/app/migrations.py` and startup database initialization;
3. inspect API serializers and frontend types;
4. inspect file-storage cleanup and ownership behavior;
5. add regression tests.

Never delete production data or run destructive database/storage operations unless explicitly requested. Never edit `.env` files unless explicitly requested.

## Security

Never expose or print API keys, passwords, JWTs, cookies, CSRF tokens, database credentials, S3 credentials, or `.env` contents.

Preserve:

- the HttpOnly `velorian_session` cookie;
- the double-submit CSRF cookie/header flow;
- ownership filtering by authenticated user;
- credentialed CORS behavior;
- backend file and payload validation;
- safe error mapping and request IDs.

Treat document and knowledge-base content as untrusted prompt data. Do not weaken the existing prompt-injection boundaries around retrieved content.

## Existing behavior to protect

Pay particular attention to:

- session restoration, registration, login, logout, and CSRF retry;
- direct conversation URLs and browser navigation;
- virtual `/chat/new` and guarded first conversation creation;
- streaming, stop, retry, edit branches, and active branch selection;
- cumulative attachment limits, object URL cleanup, generated files, and downloads;
- conversation document RAG and user knowledge-base retrieval;
- ratings and knowledge-saving thresholds;
- Markdown/code rendering and scrolling;
- structured errors and connection-restoration notifications.

## Dependencies

Before adding a dependency, verify that the project or platform does not already provide the capability. Add dependencies only when justified by the task, update the correct lockfile, and do not replace an established project abstraction without a concrete benefit.

## Validation commands

Use the existing commands; do not claim checks that were not run.

```bash
# Local application
./start.sh

# Backend tests
cd backend && .venv/bin/pytest -q

# Frontend unit tests, lint, and typed production build
cd frontend && npm run test
cd frontend && npm run lint
cd frontend && npm run build

# Frontend E2E (starts the configured Vite server)
cd frontend && npm run test:e2e
```

There is no standalone frontend `typecheck` script; `npm run build` runs `tsc -b` before Vite. There is currently no configured backend formatter, linter, or static type-check command. Do not invent these commands in reports.

## Final response

After a development task, concisely report:

1. the cause or implementation approach;
2. files changed;
3. important contract or architecture decisions;
4. checks actually run;
5. remaining risks or unverified areas.
