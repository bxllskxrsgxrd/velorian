# Velorian Frontend Instructions

These instructions apply to `frontend/` together with the repository-level `GEMINI.md`.

## Actual stack

- React 19 with functional components and hooks.
- TypeScript in strict mode with unused locals/parameters rejected.
- Vite 8; `npm run build` executes `tsc -b` and then Vite.
- React Router 7.
- Zustand 5 for all state containers.
- SCSS with component styles and shared variables/mixins.
- React Markdown, remark-gfm, and prism-react-renderer.
- Vitest + Testing Library for unit/component tests; Playwright for E2E.

Do not introduce another state library, router, styling system, or API client without an explicit requirement.

## Current structure

- `src/api/httpClient.ts`: base URL, credentialed fetch, CSRF acquisition/retry, structured `ApiError`, connection notifications.
- `src/api/chatApi.ts`: typed endpoint and NDJSON stream functions plus response normalization.
- `src/types/chat.ts`: shared frontend domain/API types.
- `src/stores/`: independent Zustand domain stores.
- `src/pages/ChatPage.tsx`: chat orchestration, route synchronization, optimistic updates, streaming and cancellation refs.
- `src/pages/KnowledgePage.tsx`: knowledge-list/query orchestration and CRUD integration.
- `src/components/`: feature and reusable UI components.
- `src/errors/`: mapping backend error codes to safe user messages.

`ChatPage` and `KnowledgePage` are known large orchestration components. Do not move their API workflows into stores mechanically. A future extraction into focused orchestration hooks/services must be a deliberate refactor with unit and E2E coverage.

## Zustand policy

The frontend has completed its state migration and does not currently use `useState`, `useReducer`, or Context as a state container. Do not reintroduce them casually.

Global domain stores are deliberately independent:

- `authStore`;
- `conversationsStore`;
- `chatStore`;
- `filesStore`;
- `knowledgeStore`;
- `promptStore`;
- `uiStore`;
- `sidebarStore`;
- `messageUiStore`;
- `notificationsStore`.

Rules:

1. Never create a single `useAppStore` or Redux-style root state tree.
2. Put state and atomic mutation actions in the matching domain store.
3. Stores should not import other stores. Coordinate multi-domain/API workflows in a component, hook, or service layer.
4. Subscribe with narrow selectors: `useStore((state) => state.value)`. Do not subscribe to an entire store object.
5. Do not return a fresh object/array from a selector on every render unless using the correct equality strategy and there is a measured reason.
6. Prefer derived selectors/render calculations over duplicating derived values in state.
7. Preserve reset actions used for route transitions and test isolation.

Ephemeral state that must be isolated per rendered component instance uses a component-scoped vanilla Zustand `createStore` with `useStore`, as seen in rating hover, Markdown editor tabs, copy buttons, prompt actions, and textarea measurement. Do not put per-instance hover/open flags into a shared global `uiStore`, and do not replace the scoped pattern with one module-level singleton.

Only accent theme and sidebar collapse currently persist, using the existing localStorage keys through theme/UI actions. Do not add Zustand `persist` middleware or change storage format unless the task requires it.

## API and errors

Use `chatApi.ts` and `httpClient.ts`; do not scatter raw API `fetch` calls through components. A direct `fetch` is acceptable only for browser-owned resource loading such as the existing file preview, with lifecycle cleanup.

`apiFetch` automatically:

- prefixes `/api` (or `VITE_API_BASE_URL`);
- sends credentials;
- adds `X-Request-ID`;
- obtains `X-CSRF-Token` for mutations;
- retries one `CSRF_INVALID` response after refreshing the token;
- normalizes errors and connection state.

Backend error envelopes use snake_case `request_id`; frontend domain objects and stream events are normalized to the existing camelCase types. Keep these conversions explicit. Do not display `developerMessage`, raw response bodies, provider errors, or stack traces to users. Add/update `userErrorMessages.ts` when introducing a backend error code.

## Conversations and streaming

The route is the source of the active conversation ID. Preserve direct URLs, `/chat/new`, legacy redirects, browser back/forward behavior, load sequencing, and not-found handling.

The current UI supports one active foreground generation:

- `ChatPage` owns one active `AbortController` ref;
- selecting a different chat intentionally aborts the current request before navigation;
- unmounting the page aborts the request;
- the backend persists cancellation/partial output.

Do not state that the current frontend supports simultaneous per-conversation streams. Adding that capability would require keyed request controllers and generation/message state by conversation, plus API and E2E review.

Streaming is newline-delimited JSON with `meta`, `delta`, `done`, and `error` events. Preserve optimistic temporary IDs and their replacement after `meta`. Delta updates are batched through `requestAnimationFrame`; keep unchanged message object references and the `MessageBubble` memoization so old messages do not rerender on every chunk.

Guard all async route loads and optimistic mutations against stale results. Preserve rating sequence protection, lazy first-conversation creation, retry payload recovery, and object URL cleanup.

## React effects and browser resources

Use effects for lifecycle work: routing synchronization, subscriptions, DOM/browser APIs, event listeners, timers, fetch cancellation, ResizeObserver, and object URL cleanup. Do not use effects merely to mirror one store field into another.

Always clean up as applicable:

- `AbortController` instances;
- event listeners and subscriptions;
- timers and animation frames;
- speech recognition handlers;
- `ResizeObserver`;
- object URLs.

Keep refs for imperative request/DOM resources rather than serializing those resources into Zustand.

## TypeScript and components

Maintain strict typing and reuse `src/types/chat.ts`. Avoid `any`, unsafe assertions, duplicate DTOs, and string values that duplicate existing role/status/tool constants.

Use props for concrete reusable component data. Use stores to avoid state/action props that are merely relayed through intermediate components. Reuse existing primitives such as `ModalDialog`, `IconButton`, `Checkbox`, `Rating`, `AutoResizeTextarea`, `DropZone`, and `SidebarButton`.

Keep accessibility behavior: semantic elements, keyboard operation, disabled states, labels, focus behavior, and visible focus styling. Do not replace buttons with clickable `div` elements.

## Styling and rendering

Use the existing SCSS architecture and naming conventions. Reuse variables/mixins and theme/accent values. Do not add Tailwind, CSS-in-JS, styled-components, or an icon library without an explicit request.

Preserve responsive layouts and test long content, loading, error, disabled, and empty states. Keep Markdown behavior for headings, GFM, code highlighting, tables, links, copy controls, and horizontal scrolling. Treat rendered Markdown as untrusted content and do not expose internal prompt markup.

## Files

Reuse the configured frontend attachment limits and `validateAndMergeFiles`. File picker, drag/drop, and large pasted-text attachments share one cumulative limit. Backend validation remains authoritative.

Preserve preview behavior and revoke locally created object URLs exactly once. Abort text-preview fetches when the file changes or the preview closes.

## Performance

Be especially careful with message streaming, Markdown, knowledge cards, conversation lists, prompt input, ratings, and modal state.

- Keep selectors narrow.
- Preserve object identity for unchanged list entries.
- Do not create new selector arrays/objects without need.
- Do not add `useMemo`/`useCallback` indiscriminately.
- When changing streaming/list rendering, verify that one item update does not rerender every expensive child.

## Testing and validation

Use the existing scripts:

```bash
cd frontend
npm run test       # Vitest, jsdom
npm run lint       # ESLint, including React Hooks rules
npm run build      # tsc -b, then Vite production build
npm run test:e2e   # Playwright; starts Vite on 127.0.0.1:4173
```

There is no standalone `typecheck` script. Update tests when store ownership or component contracts change, and reset singleton stores in test setup/beforeEach to avoid state leakage. For routing, streaming, auth, errors, files, or knowledge workflows, run the relevant Playwright tests in addition to unit tests.
