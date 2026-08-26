import type { Page, Route } from '@playwright/test';

type Options = { authenticated?: boolean; streamError?: boolean; failConversationsOnce?: boolean; multipleChats?: boolean; historicalError?: 'error' | 'cancelled' };

export async function installMockApi(page: Page, options: Options = {}) {
	let authenticated = options.authenticated ?? true;
	let failedConversationRequestsRemaining = options.failConversationsOnce ? 2 : 0;
	let conversations = options.multipleChats
		? [
			{ id: 'chat-b', title: 'Chat B', createdAt: '2026-08-25T01:00:00Z', updatedAt: '2026-08-25T01:00:00Z' },
			{ id: 'chat-a', title: 'Chat A', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' },
		]
		: [{ id: 'c1', title: 'Тестовый чат', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' }];
	const defaultMessages = options.historicalError ? [{
		id: 'historical-error', role: 'assistant', content: '', status: options.historicalError, attachments: [], replyToId: 'historical-user', error: null,
	}] : [];
	const messagesByConversation = new Map<string, unknown[]>(options.multipleChats ? [
		['chat-a', [{ id: 'message-a', role: 'assistant', content: 'Сообщения из Chat A', status: 'done', attachments: [] }]],
		['chat-b', [{ id: 'message-b', role: 'assistant', content: 'Сообщения из Chat B', status: 'done', attachments: [] }]],
	] : [['c1', defaultMessages]]);
	let knowledge: Array<Record<string, unknown>> = [];
	const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		const method = request.method();
		if (!path.startsWith('/api/')) return route.continue();

		if (path === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-e2e' });
		if (path === '/api/config') return json(route, { attachmentLimits: { maxAttachments: 10, maxFileSize: 10 * 1024 * 1024, maxTotalSize: 25 * 1024 * 1024 } });
		if (path === '/api/auth/me') return authenticated ? json(route, { user: { id: 'u1', email: 'e2e@example.com' } }) : json(route, { error: { code: 'AUTH_REQUIRED', message: 'Войдите', request_id: 'auth' } }, 401);
		if (path === '/api/auth/login') { authenticated = true; return json(route, { user: { id: 'u1', email: 'e2e@example.com' }, csrfToken: 'csrf-login' }); }
		if (path === '/api/auth/logout') { authenticated = false; return json(route, {}); }
		if (path === '/api/health') return json(route, { status: 'ok' });
		if (path === '/api/conversations' && method === 'GET') {
			if (failedConversationRequestsRemaining > 0) { failedConversationRequestsRemaining -= 1; return route.abort('connectionfailed'); }
			return json(route, { conversations });
		}
		if (path === '/api/conversations' && method === 'POST') {
			const created = { id: `c${conversations.length + 1}`, title: 'Новый чат', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
			conversations = [created, ...conversations]; messagesByConversation.set(created.id, []); return json(route, { conversation: created });
		}
		const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
		if (conversationMatch && method === 'GET') {
			const conversation = conversations.find((entry) => entry.id === conversationMatch[1]);
			if (!conversation) return json(route, { error: { code: 'CONVERSATION_NOT_FOUND', message: 'missing', request_id: 'missing-chat' } }, 404);
			return json(route, { conversation: { ...conversation, messages: messagesByConversation.get(conversation.id) ?? [] } });
		}
		if (conversationMatch && method === 'PATCH') {
			const payload = request.postDataJSON() as { title: string };
			conversations = conversations.map((entry) => entry.id === conversationMatch[1] ? { ...entry, title: payload.title } : entry);
			return json(route, { conversation: conversations.find((entry) => entry.id === conversationMatch[1]) });
		}
		if (conversationMatch && method === 'DELETE') { conversations = conversations.filter((entry) => entry.id !== conversationMatch[1]); messagesByConversation.delete(conversationMatch[1]); return route.fulfill({ status: 204 }); }

		const streamMatch = path.match(/^\/api\/conversations\/([^/]+)\/stream$/);
		if (streamMatch) {
			if (options.streamError) return json(route, { error: { code: 'AI_SERVICE_ERROR', message: 'provider details', request_id: 'e2e-502' } }, 502);
			const conversationId = streamMatch[1];
			const rawBody = request.postData() ?? '';
			const asksToBrowseKnowledge = /Что находится в моей базе знаний|Какие материалы есть в моей базе знаний/i.test(rawBody);
			const usesKnowledgeSearch = rawBody.includes('name="search_mode"') && rawBody.includes('knowledge');
			const knowledgeText = knowledge.map((item) => `${String(item.title)}: ${String(item.content)}`).join('; ');
			const answer = (asksToBrowseKnowledge || usesKnowledgeSearch) && knowledgeText ? `В вашей базе знаний: ${knowledgeText}` : 'Ответ агента';
			const userMessage = { id: `user-e2e-${Date.now()}`, role: 'user', content: 'Тестовый запрос', status: 'done', attachments: [], branchGroupId: 'user-e2e', isActive: true };
			const assistant = { id: `assistant-e2e-${Date.now()}`, role: 'assistant', content: answer, status: 'done', attachments: [], replyToId: userMessage.id };
			messagesByConversation.set(conversationId, [...(messagesByConversation.get(conversationId) ?? []), userMessage, assistant]);
			const conversation = conversations.find((entry) => entry.id === conversationId);
			const stream = [
				{ type: 'meta', conversationId, conversationTitle: conversation?.title ?? 'Тестовый чат', userMessage, assistantMessageId: assistant.id, requestId: 'stream-e2e' },
				{ type: 'delta', content: answer },
				{ type: 'done', messageId: assistant.id, message: assistant },
			].map((event) => JSON.stringify(event)).join('\n') + '\n';
			return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: stream });
		}
		if (/^\/api\/messages\/[^/]+\/rating$/.test(path)) return json(route, { rating: { id: 'r1', score: 5, comment: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });

		if (path === '/api/knowledge' && method === 'GET') return json(route, { items: knowledge, pageInfo: { nextCursor: null, hasMore: false } });
		if (path === '/api/knowledge' && method === 'POST') {
			const payload = request.postDataJSON() as { title: string; content: string; rating?: number };
			const item = { id: `k${knowledge.length + 1}`, sourceType: 'manual', title: payload.title, content: payload.content, mimeType: 'text/plain', rating: payload.rating ?? null, isActive: true, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), downloadUrl: null };
			knowledge = [item, ...knowledge]; return json(route, { item });
		}
		const knowledgeMatch = path.match(/^\/api\/knowledge\/([^/]+)$/);
		if (knowledgeMatch && method === 'PATCH') {
			const payload = request.postDataJSON() as Record<string, unknown>;
			knowledge = knowledge.map((item) => item.id === knowledgeMatch[1] ? { ...item, ...payload, isActive: payload.is_active ?? item.isActive } : item);
			return json(route, { item: knowledge.find((item) => item.id === knowledgeMatch[1]) });
		}
		if (knowledgeMatch && method === 'DELETE') return route.fulfill({ status: 204 });
		return json(route, { error: { code: 'E2E_MOCK_MISSING', message: `${method} ${path}`, request_id: 'mock' } }, 500);
	});
}
