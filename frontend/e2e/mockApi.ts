import type { Page, Route } from '@playwright/test';

type Options = { authenticated?: boolean; streamError?: boolean; failConversationsOnce?: boolean };

export async function installMockApi(page: Page, options: Options = {}) {
	let authenticated = options.authenticated ?? true;
	let failedConversationRequestsRemaining = options.failConversationsOnce ? 2 : 0;
	let conversations = [{ id: 'c1', title: 'Тестовый чат', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' }];
	let messages: unknown[] = [];
	let knowledge: Array<Record<string, unknown>> = [];
	const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		const method = request.method();
		if (!path.startsWith('/api/')) return route.continue();

		if (path === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-e2e' });
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
			conversations = [created, ...conversations]; return json(route, { conversation: created });
		}
		const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
		if (conversationMatch && method === 'GET') {
			const conversation = conversations.find((entry) => entry.id === conversationMatch[1]) ?? conversations[0];
			return json(route, { conversation: { ...conversation, messages } });
		}
		if (conversationMatch && method === 'PATCH') {
			const payload = request.postDataJSON() as { title: string };
			conversations = conversations.map((entry) => entry.id === conversationMatch[1] ? { ...entry, title: payload.title } : entry);
			return json(route, { conversation: conversations.find((entry) => entry.id === conversationMatch[1]) });
		}
		if (conversationMatch && method === 'DELETE') return route.fulfill({ status: 204 });

		if (/^\/api\/conversations\/[^/]+\/stream$/.test(path)) {
			if (options.streamError) return json(route, { error: { code: 'AI_SERVICE_ERROR', message: 'provider details', request_id: 'e2e-502' } }, 502);
			const userMessage = { id: 'user-e2e', role: 'user', content: 'Тестовый запрос', status: 'done', attachments: [], branchGroupId: 'user-e2e', isActive: true };
			const assistant = { id: 'assistant-e2e', role: 'assistant', content: 'Ответ агента', status: 'done', attachments: [], replyToId: 'user-e2e' };
			messages = [...messages, userMessage, assistant];
			const stream = [
				{ type: 'meta', conversationId: 'c1', conversationTitle: 'Тестовый чат', userMessage, assistantMessageId: 'assistant-e2e', requestId: 'stream-e2e' },
				{ type: 'delta', content: 'Ответ агента' },
				{ type: 'done', messageId: 'assistant-e2e', message: assistant },
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
