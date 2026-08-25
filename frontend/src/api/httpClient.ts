import { getUserErrorMessage } from '../errors/userErrorMessages';
import { reportError } from '../utils/reportError';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
export const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;

type ApiErrorPayload = {
	error?: { code?: string; message?: string; request_id?: string };
};

export class ApiError extends Error {
	readonly code: string;
	readonly status: number;
	readonly requestId?: string;
	readonly developerMessage?: string;
	readonly responseBody?: unknown;

	constructor(code: string, status: number, requestId?: string, developerMessage?: string, responseBody?: unknown) {
		super(getUserErrorMessage(code, status));
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
		this.requestId = requestId;
		this.developerMessage = developerMessage;
		this.responseBody = responseBody;
	}
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
const connectionListeners = new Set<(connected: boolean) => void>();
let connected = true;

function setConnectionState(next: boolean) {
	if (connected === next) return;
	connected = next;
	connectionListeners.forEach((listener) => listener(next));
}

export function subscribeConnection(listener: (connected: boolean) => void) {
	connectionListeners.add(listener);
	listener(connected);
	return () => connectionListeners.delete(listener);
}

export function setCsrfToken(token: string | null) {
	csrfToken = token;
}

export async function ensureCsrfToken(force = false) {
	if (!force && csrfToken) return csrfToken;
	if (!force && csrfRequest) return csrfRequest;
	csrfRequest = fetch(`${API_BASE_URL}/auth/csrf`, { credentials: 'include' })
		.then(async (response) => {
			if (!response.ok) throw await parseApiError(response);
			const payload = (await response.json()) as { csrfToken: string };
			csrfToken = payload.csrfToken;
			return payload.csrfToken;
		})
		.finally(() => { csrfRequest = null; });
	return csrfRequest;
}

export async function parseApiError(response: Response): Promise<ApiError> {
	let payload: ApiErrorPayload | null = null;
	try {
		payload = (await response.json()) as ApiErrorPayload;
	} catch (error) {
		reportError('API_ERROR_BODY_INVALID', error, { status: response.status });
	}
	return new ApiError(
		payload?.error?.code ?? (response.status >= 500 ? 'BACKEND_UNAVAILABLE' : 'HTTP_ERROR'),
		response.status,
		payload?.error?.request_id ?? response.headers.get('X-Request-ID') ?? undefined,
		payload?.error?.message,
		payload,
	);
}

function isMutation(method: string) {
	return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export async function apiFetch(path: string, init: RequestInit = {}, retryCsrf = true): Promise<Response> {
	const method = init.method ?? 'GET';
	const requestId = crypto.randomUUID();
	const token = isMutation(method) ? await ensureCsrfToken() : null;
	const started = performance.now();
	try {
		const response = await fetch(`${API_BASE_URL}${path}`, {
			...init,
			credentials: 'include',
			headers: {
				...(init.body instanceof FormData ? {} : init.body ? { 'Content-Type': 'application/json' } : {}),
				'X-Request-ID': requestId,
				...(token ? { 'X-CSRF-Token': token } : {}),
				...init.headers,
			},
		});
		if (!response.ok) {
			const error = await parseApiError(response);
			if (retryCsrf && error.code === 'CSRF_INVALID') {
				await ensureCsrfToken(true);
				return apiFetch(path, init, false);
			}
			throw error;
		}
		setConnectionState(true);
		return response;
	} catch (error) {
		const normalized = error instanceof ApiError
			? error
			: new ApiError(error instanceof DOMException && error.name === 'AbortError' ? 'REQUEST_ABORTED' : 'NETWORK_ERROR', 0, requestId, error instanceof Error ? error.message : String(error));
		if (normalized.code !== 'REQUEST_ABORTED') {
			if (normalized.code === 'NETWORK_ERROR' || normalized.code === 'BACKEND_UNAVAILABLE') setConnectionState(false);
			reportError('API_REQUEST_FAILED', normalized, {
				requestId: normalized.requestId ?? requestId,
				endpoint: path,
				method,
				status: normalized.status,
				errorCode: normalized.code,
				cause: normalized.developerMessage,
				durationMs: Math.round(performance.now() - started),
			});
		}
		throw normalized;
	}
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	return (await apiFetch(path, init)).json() as Promise<T>;
}
