import type { AuthUser, ChatAttachment, ChatMessage, Conversation, ConversationSummary, KnowledgeApproach, KnowledgeFilterDefinition, KnowledgeFilterOption, KnowledgeItem, KnowledgePageResult, MessageRating, SearchMode } from '../types/chat';
import type { AttachmentLimits } from '../constants/attachmentLimits';
import { getUserFacingError } from '../errors/userErrorMessages';
import { reportError } from '../utils/reportError';
import { API_ORIGIN, ApiError, apiFetch, requestJson, setCsrfToken } from './httpClient';

export { ApiError } from './httpClient';

function resolveAttachmentUrl(url: string) {
	return url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
}

function normalizeAttachment(attachment: Omit<ChatAttachment, 'isImage'> & { isImage?: boolean }): ChatAttachment {
	return {
		...attachment,
		url: resolveAttachmentUrl(attachment.url),
		downloadUrl: attachment.downloadUrl ? resolveAttachmentUrl(attachment.downloadUrl) : resolveAttachmentUrl(attachment.url),
		isImage: attachment.type.startsWith('image/'),
	};
}

function normalizeMessage(message: ChatMessage): ChatMessage {
	const persistedError = message.error;
	const persistedErrorCode = persistedError?.code ?? message.errorCode;
	return {
		...message,
		attachments: message.attachments?.map(normalizeAttachment) ?? [],
		knowledgeSources: message.knowledgeSources ?? [],
		error: message.status === 'error'
			? getUserFacingError(persistedErrorCode ?? 'HISTORICAL_MESSAGE_ERROR', 0, persistedError?.requestId ?? message.requestId)
			: undefined,
	};
}

function normalizeKnowledgeItem(item: KnowledgeItem): KnowledgeItem {
	return {
		...item,
		rating: item.rating ?? null,
		metadata: item.metadata ?? {},
		approach: item.approach ?? null,
		filters: item.filters ?? [],
		downloadUrl: item.downloadUrl?.startsWith('/') ? `${API_ORIGIN}${item.downloadUrl}` : item.downloadUrl,
	};
}

function parseStreamEvent(line: string): StreamEvent {
	try {
		return JSON.parse(line) as StreamEvent;
	} catch (error) {
		throw new ApiError('MALFORMED_RESPONSE', 200, undefined, error instanceof Error ? error.message : String(error));
	}
}

export async function getCurrentUser(): Promise<AuthUser> {
	return (await requestJson<{ user: AuthUser }>('/auth/me')).user;
}

export async function getRuntimeConfig(): Promise<{ attachmentLimits: AttachmentLimits }> {
	return requestJson<{ attachmentLimits: AttachmentLimits }>('/config');
}

export async function authenticate(mode: 'login' | 'register', email: string, password: string): Promise<AuthUser> {
	const payload = await requestJson<{ user: AuthUser; csrfToken: string }>(`/auth/${mode}`, {
			method: 'POST',
			body: JSON.stringify({ email, password }),
		});
	setCsrfToken(payload.csrfToken);
	return payload.user;
}

export async function logout(): Promise<void> {
	await requestJson('/auth/logout', { method: 'POST' });
	setCsrfToken(null);
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
	await apiFetch(`/conversations/${id}`, { method: 'DELETE' });
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
	| { type: 'done'; messageId: string; message?: ChatMessage }
	| { type: 'error'; code: string; message: string; requestId?: string };

type StreamChatOptions = {
	conversationId: string;
	prompt?: string;
	files?: File[];
	searchMode?: SearchMode;
	retryMessageId?: string;
	editMessageId?: string;
	signal: AbortSignal;
	onEvent: (event: StreamEvent) => void;
};

async function runChatStream(options: StreamChatOptions): Promise<void> {
	const formData = new FormData();
	formData.append('prompt', options.prompt ?? '');
	formData.append('search_mode', options.searchMode ?? 'none');
	if (options.retryMessageId) formData.append('retry_message_id', options.retryMessageId);
	if (options.editMessageId) formData.append('edit_message_id', options.editMessageId);
	options.files?.forEach((file) => formData.append('files', file));

	const response = await apiFetch(`/conversations/${options.conversationId}/stream`, {
		method: 'POST',
		body: formData,
		signal: options.signal,
	});
	if (!response.body) throw new ApiError('STREAM_UNAVAILABLE', 0, undefined, 'ReadableStream is unavailable');

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
			const event = parseStreamEvent(line);
			if (event.type === 'meta') event.userMessage = normalizeMessage(event.userMessage);
			if (event.type === 'done' && event.message) event.message = normalizeMessage(event.message);
			options.onEvent(event);
			if (event.type === 'error') throw new ApiError(event.code, 200, event.requestId, event.message);
		}
		if (done) break;
	}
	if (buffer.trim()) {
		const event = parseStreamEvent(buffer);
		if (event.type === 'meta') event.userMessage = normalizeMessage(event.userMessage);
		if (event.type === 'done' && event.message) event.message = normalizeMessage(event.message);
		options.onEvent(event);
		if (event.type === 'error') throw new ApiError(event.code, 200, event.requestId, event.message);
	}
}

export async function setMessageRating(messageId: string, score: number, comment?: string): Promise<MessageRating> {
	return (await requestJson<{ rating: MessageRating }>(`/messages/${messageId}/rating`, {
		method: 'PUT',
		body: JSON.stringify({ score, comment: comment || null }),
	})).rating;
}

export async function removeMessageRating(messageId: string): Promise<void> {
	await apiFetch(`/messages/${messageId}/rating`, { method: 'DELETE' });
}

export async function saveMessageToKnowledge(messageId: string): Promise<KnowledgeItem[]> {
	return (await requestJson<{ items: KnowledgeItem[] }>(`/knowledge/messages/${messageId}`, { method: 'POST' })).items.map(normalizeKnowledgeItem);
}

export async function listKnowledge(params: { search?: string; sourceType?: string; approachId?: string; filterOptionIds?: string[]; isActive?: boolean; minRating?: number; unrated?: boolean; sort?: string; limit?: number; cursor?: string } = {}): Promise<KnowledgePageResult> {
	const query = new URLSearchParams();
	if (params.search) query.set('search', params.search);
	if (params.sourceType) query.set('source_type', params.sourceType);
	if (params.approachId) query.set('approach_id', params.approachId);
	params.filterOptionIds?.forEach((optionId) => query.append('filter_option_id', optionId));
	if (params.isActive !== undefined) query.set('is_active', String(params.isActive));
	if (params.minRating !== undefined) query.set('min_rating', String(params.minRating));
	if (params.unrated) query.set('unrated', 'true');
	if (params.sort) query.set('sort', params.sort);
	if (params.limit) query.set('limit', String(params.limit));
	if (params.cursor) query.set('cursor', params.cursor);
	const result = await requestJson<KnowledgePageResult>(`/knowledge${query.size ? `?${query}` : ''}`);
	return { ...result, items: result.items.map(normalizeKnowledgeItem) };
}

export async function createKnowledgeItem(title: string, content: string, rating: number | null = null, isActive = true, approachId: string | null = null, filterOptionIds: string[] = []): Promise<KnowledgeItem> {
	return normalizeKnowledgeItem((await requestJson<{ item: KnowledgeItem }>('/knowledge', { method: 'POST', body: JSON.stringify({ title, content, rating, is_active: isActive, approach_id: approachId, filter_option_ids: filterOptionIds }) })).item);
}

export async function uploadKnowledgeFile(file: File, title = '', rating: number | null = null, isActive = true, approachId: string | null = null, filterOptionIds: string[] = []): Promise<KnowledgeItem> {
	const body = new FormData();
	body.append('file', file);
	body.append('title', title);
	if (rating !== null) body.append('rating', String(rating));
	body.append('is_active', String(isActive));
	if (approachId) body.append('approach_id', approachId);
	body.append('filter_option_ids', JSON.stringify(filterOptionIds));
	return normalizeKnowledgeItem((await requestJson<{ item: KnowledgeItem }>('/knowledge/files', { method: 'POST', body })).item);
}

export async function updateKnowledgeItem(id: string, patch: { title?: string; content?: string; isActive?: boolean; rating?: number | null; approachId?: string | null; filterOptionIds?: string[] }): Promise<KnowledgeItem> {
	return normalizeKnowledgeItem((await requestJson<{ item: KnowledgeItem }>(`/knowledge/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ title: patch.title, content: patch.content, is_active: patch.isActive, rating: patch.rating, approach_id: patch.approachId, filter_option_ids: patch.filterOptionIds }),
	})).item);
}

export async function listKnowledgeApproaches(): Promise<KnowledgeApproach[]> {
	return (await requestJson<{ items: KnowledgeApproach[] }>('/knowledge/approaches')).items;
}

export async function createKnowledgeApproach(name: string): Promise<KnowledgeApproach> {
	return (await requestJson<{ item: KnowledgeApproach }>('/knowledge/approaches', {
		method: 'POST', body: JSON.stringify({ name }),
	})).item;
}

export async function renameKnowledgeApproach(id: string, name: string): Promise<KnowledgeApproach> {
	return (await requestJson<{ item: KnowledgeApproach }>(`/knowledge/approaches/${id}`, {
		method: 'PATCH', body: JSON.stringify({ name }),
	})).item;
}

export async function deleteKnowledgeApproach(id: string): Promise<void> {
	await apiFetch(`/knowledge/approaches/${id}`, { method: 'DELETE' });
}

export async function listKnowledgeFilters(): Promise<KnowledgeFilterDefinition[]> {
	return (await requestJson<{ items: KnowledgeFilterDefinition[] }>('/knowledge/filters')).items;
}

export async function createKnowledgeFilter(name: string): Promise<KnowledgeFilterDefinition> {
	return (await requestJson<{ item: KnowledgeFilterDefinition }>('/knowledge/filters', {
		method: 'POST', body: JSON.stringify({ name }),
	})).item;
}

export async function createKnowledgeFilterOption(filterId: string, value: string): Promise<KnowledgeFilterOption> {
	return (await requestJson<{ item: KnowledgeFilterOption }>(`/knowledge/filters/${filterId}/options`, {
		method: 'POST', body: JSON.stringify({ value }),
	})).item;
}

export async function saveGeneratedFileToKnowledge(attachmentId: string, payload: { title: string; rating: number | null; isActive: boolean; filterOptionIds: string[] }): Promise<KnowledgeItem> {
	return normalizeKnowledgeItem((await requestJson<{ item: KnowledgeItem }>(`/knowledge/generated-files/${attachmentId}`, {
		method: 'POST',
		body: JSON.stringify({ title: payload.title, rating: payload.rating, is_active: payload.isActive, filter_option_ids: payload.filterOptionIds }),
	})).item);
}

export async function deleteKnowledgeItem(id: string): Promise<void> {
	await apiFetch(`/knowledge/${id}`, { method: 'DELETE' });
}

export async function activateMessageBranch(messageId: string): Promise<ChatMessage> {
	return (
		await requestJson<{ message: ChatMessage }>(`/messages/${messageId}/activate`, {
			method: 'PATCH',
		})
	).message;
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
	try {
		await runChatStream(options);
	} catch (error) {
		if (!(error instanceof ApiError && error.code === 'REQUEST_ABORTED')) {
			reportError('Потоковый запрос к AI', error, {
				code: error instanceof ApiError ? error.code : undefined,
				status: error instanceof ApiError ? error.status : undefined,
				requestId: error instanceof ApiError ? error.requestId : undefined,
			});
		}
		throw error;
	}
}
