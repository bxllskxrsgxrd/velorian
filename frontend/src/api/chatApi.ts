import type { AuthUser, ChatAttachment, ChatMessage, Conversation, ConversationSummary } from '../types/chat';
import { reportError } from '../utils/reportError';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;

type ApiErrorPayload = {
	error?: {
		code?: string;
		message?: string;
		request_id?: string;
	};
};

export class ApiError extends Error {
	readonly code: string;
	readonly status: number;
	readonly requestId?: string;
	readonly responseBody?: unknown;

	constructor(message: string, code = 'API_ERROR', status = 0, requestId?: string, responseBody?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
		this.requestId = requestId;
		this.responseBody = responseBody;
	}
}

function resolveAttachmentUrl(url: string) {
	return url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
}

function normalizeAttachment(attachment: Omit<ChatAttachment, 'isImage'> & { isImage?: boolean }): ChatAttachment {
	return {
		...attachment,
		url: resolveAttachmentUrl(attachment.url),
		isImage: attachment.type.startsWith('image/'),
	};
}

function normalizeMessage(message: ChatMessage): ChatMessage {
	return {
		...message,
		attachments: message.attachments?.map(normalizeAttachment) ?? [],
	};
}

async function parseApiError(response: Response): Promise<ApiError> {
	let payload: ApiErrorPayload | null = null;
	try {
		payload = (await response.json()) as ApiErrorPayload;
	} catch (error) {
		reportError('Не удалось разобрать ответ с ошибкой API', error, { status: response.status });
	}
	return new ApiError(
		payload?.error?.message ?? `Ошибка сервера: ${response.status}`,
		payload?.error?.code ?? 'HTTP_ERROR',
		response.status,
		payload?.error?.request_id,
		payload,
	);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const method = init?.method ?? 'GET';
	try {
		const response = await fetch(`${API_BASE_URL}${path}`, {
			...init,
			credentials: 'include',
			headers: {
				...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
				...init?.headers,
			},
		});
		if (!response.ok) throw await parseApiError(response);
		return (await response.json()) as T;
	} catch (error) {
		reportError(`API ${method} ${path}`, error, {
			code: error instanceof ApiError ? error.code : undefined,
			status: error instanceof ApiError ? error.status : undefined,
			requestId: error instanceof ApiError ? error.requestId : undefined,
		});
		throw error;
	}
}

export async function getCurrentUser(): Promise<AuthUser> {
	return (await requestJson<{ user: AuthUser }>('/auth/me')).user;
}

export async function authenticate(mode: 'login' | 'register', email: string, password: string): Promise<AuthUser> {
	return (
		await requestJson<{ user: AuthUser }>(`/auth/${mode}`, {
			method: 'POST',
			body: JSON.stringify({ email, password }),
		})
	).user;
}

export async function logout(): Promise<void> {
	await requestJson('/auth/logout', { method: 'POST' });
}

export async function listConversations(): Promise<ConversationSummary[]> {
	return (await requestJson<{ conversations: ConversationSummary[] }>('/conversations')).conversations;
}

export async function createConversation(title = 'Новый чат'): Promise<ConversationSummary> {
	return (
		await requestJson<{ conversation: ConversationSummary }>('/conversations', {
			method: 'POST',
			body: JSON.stringify({ title }),
		})
	).conversation;
}

export async function getConversation(id: string): Promise<Conversation> {
	const { conversation } = await requestJson<{ conversation: Conversation }>(`/conversations/${id}`);
	return { ...conversation, messages: conversation.messages.map(normalizeMessage) };
}

export async function renameConversation(id: string, title: string): Promise<ConversationSummary> {
	return (
		await requestJson<{ conversation: ConversationSummary }>(`/conversations/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ title }),
		})
	).conversation;
}

export async function deleteConversation(id: string): Promise<void> {
	try {
		const response = await fetch(`${API_BASE_URL}/conversations/${id}`, {
			method: 'DELETE',
			credentials: 'include',
		});
		if (!response.ok) throw await parseApiError(response);
	} catch (error) {
		reportError('API DELETE /conversations/:id', error, {
			code: error instanceof ApiError ? error.code : undefined,
			status: error instanceof ApiError ? error.status : undefined,
			requestId: error instanceof ApiError ? error.requestId : undefined,
		});
		throw error;
	}
}

export type StreamEvent =
	| {
			type: 'meta';
			conversationId: string;
			conversationTitle: string;
			userMessage: ChatMessage;
			assistantMessageId: string;
			requestId: string;
	  }
	| { type: 'delta'; content: string }
	| { type: 'done'; messageId: string }
	| { type: 'error'; code: string; message: string; requestId?: string };

type StreamChatOptions = {
	conversationId: string;
	prompt?: string;
	files?: File[];
	webSearch?: boolean;
	retryMessageId?: string;
	signal: AbortSignal;
	onEvent: (event: StreamEvent) => void;
};

async function runChatStream(options: StreamChatOptions): Promise<void> {
	const formData = new FormData();
	formData.append('prompt', options.prompt ?? '');
	formData.append('web_search', String(Boolean(options.webSearch)));
	if (options.retryMessageId) formData.append('retry_message_id', options.retryMessageId);
	options.files?.forEach((file) => formData.append('files', file));

	const response = await fetch(`${API_BASE_URL}/conversations/${options.conversationId}/stream`, {
		method: 'POST',
		body: formData,
		signal: options.signal,
		credentials: 'include',
	});
	if (!response.ok) throw await parseApiError(response);
	if (!response.body) throw new ApiError('Браузер не поддерживает потоковые ответы', 'STREAM_UNAVAILABLE');

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { value, done } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) continue;
			const event = JSON.parse(line) as StreamEvent;
			if (event.type === 'meta') event.userMessage = normalizeMessage(event.userMessage);
			options.onEvent(event);
			if (event.type === 'error') throw new ApiError(event.message, event.code, 200, event.requestId);
		}
		if (done) break;
	}
	if (buffer.trim()) {
		const event = JSON.parse(buffer) as StreamEvent;
		if (event.type === 'meta') event.userMessage = normalizeMessage(event.userMessage);
		options.onEvent(event);
		if (event.type === 'error') throw new ApiError(event.message, event.code, 200, event.requestId);
	}
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
	try {
		await runChatStream(options);
	} catch (error) {
		if (!(error instanceof DOMException && error.name === 'AbortError')) {
			reportError('Потоковый запрос к AI', error, {
				code: error instanceof ApiError ? error.code : undefined,
				status: error instanceof ApiError ? error.status : undefined,
				requestId: error instanceof ApiError ? error.requestId : undefined,
			});
		}
		throw error;
	}
}
