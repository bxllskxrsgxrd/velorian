import type { Page, Route } from '@playwright/test';

type Options = { authenticated?: boolean; streamError?: boolean; failConversationsOnce?: boolean; multipleChats?: boolean; manyChats?: boolean; manyKnowledge?: boolean; longMarkdown?: boolean; historicalError?: 'error' | 'cancelled' };

export async function installMockApi(page: Page, options: Options = {}) {
	let conversationCreateCount = 0;
	let authenticated = options.authenticated ?? true;
	let failedConversationRequestsRemaining = options.failConversationsOnce ? 2 : 0;
	let conversations = options.manyChats
		? Array.from({ length: 36 }, (_, index) => ({
			id: `chat-${index + 1}`, title: `Длинный список — чат ${index + 1}`,
			createdAt: `2026-08-25T00:${String(index).padStart(2, '0')}:00Z`, updatedAt: `2026-08-25T00:${String(index).padStart(2, '0')}:00Z`,
		}))
		: options.multipleChats
		? [
			{ id: 'chat-b', title: 'Chat B', createdAt: '2026-08-25T01:00:00Z', updatedAt: '2026-08-25T01:00:00Z' },
			{ id: 'chat-a', title: 'Chat A', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' },
		]
		: [{ id: 'c1', title: 'Тестовый чат', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' }];
	const defaultMessages = options.historicalError
	? [
			{
				id: 'historical-user',
				role: 'user',
				content: 'Тестовый запрос',
				status: 'done',
				attachments: [],
				branchGroupId: 'historical-user',
				isActive: true,
			},
			{
				id: 'historical-error',
				role: 'assistant',
				content: '',
				status: options.historicalError,
				attachments: [],
				replyToId: 'historical-user',
				error: null,
			},
		]
	: [];
	const messagesByConversation = new Map<string, unknown[]>(options.multipleChats ? [
		['chat-a', [{ id: 'message-a', role: 'assistant', content: 'Сообщения из Chat A', status: 'done', attachments: [] }]],
		['chat-b', [{ id: 'message-b', role: 'assistant', content: 'Сообщения из Chat B', status: 'done', attachments: [] }]],
	] : [['c1', defaultMessages]]);
	if (options.manyChats) conversations.forEach((conversation) => messagesByConversation.set(conversation.id, []));
	let knowledge: Array<Record<string, unknown>> = options.manyKnowledge
		? Array.from({ length: 30 }, (_, index) => ({
			id: `knowledge-${index + 1}`, sourceType: 'manual', title: `Материал ${index + 1}`,
			content: `Содержимое материала ${index + 1}`, mimeType: 'text/markdown', rating: null, approach: null, filters: [],
			isActive: true, metadata: {}, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z', downloadUrl: null,
		}))
		: [];
	let approaches = [
		{ id: 'approach-interview', name: 'Интервью', slug: 'интервью', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' },
		{ id: 'approach-show', name: 'Шоу', slug: 'шоу', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' },
	];
	let filterDefinitions = [{
		id: 'filter-approach', name: 'Подход', normalizedName: 'подход', slug: 'podhod', type: 'multi_select', isSystem: true, itemCount: 0,
		options: [
			{ id: 'approach-interview', value: 'Интервью', normalizedValue: 'интервью', itemCount: 0, aliases: [] },
			{ id: 'approach-show', value: 'Шоу', normalizedValue: 'шоу', itemCount: 0, aliases: [] },
		],
		createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
	}];
	const resolveFilters = (optionIds: string[] = []) => filterDefinitions.flatMap((definition) => definition.options
		.filter((option) => optionIds.includes(option.id))
		.map((option) => ({ filterId: definition.id, filterName: definition.name, filterSlug: definition.slug, optionId: option.id, value: option.value })));
	const payloadOptionIds = (payload: { filter_option_ids?: string[]; filters?: Array<{ filter_id: string; option_ids: string[] }> }) => [
		...(payload.filter_option_ids ?? []),
		...(payload.filters ?? []).flatMap((group) => group.option_ids),
	];
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
			conversationCreateCount += 1;
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
			const knowledgeText = knowledge.filter((item) => item.isActive).map((item) => `${String(item.title)}: ${String(item.content)}`).join('; ');
			const answer = options.longMarkdown
				? `\`\`\`text\n${'очень-длинная-строка-кода-'.repeat(35)}\n\`\`\``
				: (asksToBrowseKnowledge || usesKnowledgeSearch) && knowledgeText ? `В вашей базе знаний: ${knowledgeText}` : 'Ответ агента';
			const userMessage = { id: `user-e2e-${Date.now()}`, role: 'user', content: 'Тестовый запрос', status: 'done', attachments: [], branchGroupId: 'user-e2e', isActive: true };
			const generated = /(?:закинь|создай файл с этим скриптом|сохрани результат в файл)/iu.test(rawBody);
			const generatedId = `generated-${Date.now()}`;
			const assistant = { id: `assistant-e2e-${Date.now()}`, role: 'assistant', content: generated ? 'Файл подготовлен.' : answer, status: 'done', attachments: generated ? [{ id: generatedId, name: 'script.js', size: 24, type: 'text/javascript', url: `/api/attachments/${generatedId}`, downloadUrl: `/api/attachments/${generatedId}?download=true`, isImage: false, extractionStatus: 'generated', generated: true, knowledgeItemId: null }] : [], replyToId: userMessage.id };
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

		if (path === '/api/knowledge/approaches' && method === 'GET') return json(route, { items: approaches });
		if (path === '/api/knowledge/approaches' && method === 'POST') {
			const payload = request.postDataJSON() as { name: string };
			const item = { id: `approach-${approaches.length + 1}`, name: payload.name, slug: payload.name.toLocaleLowerCase('ru'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
			approaches = [...approaches, item];
			return json(route, { item });
		}
		if (path === '/api/knowledge/filters' && method === 'GET') return json(route, { items: filterDefinitions });
		if (path === '/api/knowledge/filters' && method === 'POST') {
			const payload = request.postDataJSON() as { name: string };
			const item = { id: `filter-${filterDefinitions.length + 1}`, name: payload.name, normalizedName: payload.name.toLocaleLowerCase('ru'), slug: payload.name.toLocaleLowerCase('ru'), type: 'multi_select', isSystem: false, itemCount: 0, options: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
			filterDefinitions = [...filterDefinitions, item];
			return json(route, { item });
		}
		const filterMatch = path.match(/^\/api\/knowledge\/filters\/([^/]+)$/);
		if (filterMatch && method === 'PATCH') {
			const payload = request.postDataJSON() as { name: string };
			filterDefinitions = filterDefinitions.map((definition) => definition.id === filterMatch[1] ? { ...definition, name: payload.name.trim(), normalizedName: payload.name.trim().toLocaleLowerCase('ru') } : definition);
			knowledge = knowledge.map((item) => ({ ...item, filters: ((item.filters as Array<Record<string, unknown>>) ?? []).map((value) => value.filterId === filterMatch[1] ? { ...value, filterName: payload.name.trim() } : value) }));
			return json(route, { item: filterDefinitions.find((definition) => definition.id === filterMatch[1]) });
		}
		if (filterMatch && method === 'DELETE') {
			filterDefinitions = filterDefinitions.filter((definition) => definition.id !== filterMatch[1]);
			knowledge = knowledge.map((item) => ({ ...item, filters: ((item.filters as Array<Record<string, unknown>>) ?? []).filter((value) => value.filterId !== filterMatch[1]) }));
			return route.fulfill({ status: 204 });
		}
		const filterOptionMatch = path.match(/^\/api\/knowledge\/filters\/([^/]+)\/options$/);
		if (filterOptionMatch && method === 'POST') {
			const payload = request.postDataJSON() as { value: string };
			const option = { id: `option-${Date.now()}`, value: payload.value, normalizedValue: payload.value.toLocaleLowerCase('ru'), itemCount: 0, aliases: [] };
			filterDefinitions = filterDefinitions.map((definition) => definition.id === filterOptionMatch[1] ? { ...definition, options: [...definition.options, option] } : definition);
			return json(route, { item: option });
		}
		const optionMatch = path.match(/^\/api\/knowledge\/filters\/([^/]+)\/options\/([^/]+)$/);
		if (optionMatch && method === 'PATCH') {
			const payload = request.postDataJSON() as { value: string };
			let updated: Record<string, unknown> | undefined;
			filterDefinitions = filterDefinitions.map((definition) => definition.id === optionMatch[1] ? { ...definition, options: definition.options.map((option) => {
				if (option.id !== optionMatch[2]) return option;
				updated = { ...option, value: payload.value.trim(), normalizedValue: payload.value.trim().toLocaleLowerCase('ru') };
				return updated as typeof option;
			}) } : definition);
			knowledge = knowledge.map((item) => ({ ...item, filters: ((item.filters as Array<Record<string, unknown>>) ?? []).map((value) => value.optionId === optionMatch[2] ? { ...value, value: payload.value.trim() } : value) }));
			return json(route, { item: updated });
		}
		if (optionMatch && method === 'DELETE') {
			filterDefinitions = filterDefinitions.map((definition) => definition.id === optionMatch[1] ? { ...definition, options: definition.options.filter((option) => option.id !== optionMatch[2]) } : definition);
			knowledge = knowledge.map((item) => ({ ...item, filters: ((item.filters as Array<Record<string, unknown>>) ?? []).filter((value) => value.optionId !== optionMatch[2]) }));
			return route.fulfill({ status: 204 });
		}
		if (path === '/api/knowledge' && method === 'GET') {
			const legacyOptionIds = url.searchParams.getAll('filter_option_id');
			const groups = url.searchParams.get('filters') ? JSON.parse(url.searchParams.get('filters')!) as Array<{ filter_id: string; option_ids: string[] }> : [];
			if (legacyOptionIds.length) groups.push(...legacyOptionIds.map((optionId) => ({ filter_id: '', option_ids: [optionId] })));
			const items = groups.length ? knowledge.filter((item) => groups.every((group) => group.option_ids.some((id) => ((item.filters as Array<{ optionId: string }> | undefined) ?? []).some((value) => value.optionId === id)))) : knowledge;
			return json(route, { items, pageInfo: { nextCursor: null, hasMore: false } });
		}
		if (path === '/api/knowledge' && method === 'POST') {
			const payload = request.postDataJSON() as { title: string; content: string; rating?: number; is_active?: boolean; filter_option_ids?: string[]; filters?: Array<{ filter_id: string; option_ids: string[] }> };
			const item = { id: `k${knowledge.length + 1}`, sourceType: 'manual', title: payload.title, content: payload.content, mimeType: 'text/markdown', originalFilename: `knowledge-${knowledge.length + 1}.md`, rating: payload.rating ?? null, approach: null, filters: resolveFilters(payloadOptionIds(payload)), isActive: payload.is_active ?? true, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), downloadUrl: null };
			knowledge = [item, ...knowledge]; return json(route, { item });
		}
		const generatedKnowledgeMatch = path.match(/^\/api\/knowledge\/generated-files\/([^/]+)$/);
		if (generatedKnowledgeMatch && method === 'POST') {
			const payload = request.postDataJSON() as { title: string; rating?: number | null; is_active?: boolean; filter_option_ids?: string[]; filters?: Array<{ filter_id: string; option_ids: string[] }> };
			const item = { id: `k${knowledge.length + 1}`, sourceType: 'assistant_generated_file', sourceFileId: generatedKnowledgeMatch[1], title: payload.title, content: 'console.log("Velorian");', mimeType: 'text/javascript', originalFilename: 'script.js', rating: payload.rating ?? null, approach: null, filters: resolveFilters(payloadOptionIds(payload)), isActive: payload.is_active ?? true, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), downloadUrl: `/api/attachments/${generatedKnowledgeMatch[1]}` };
			knowledge = [item, ...knowledge];
			return json(route, { item });
		}
		const knowledgeMatch = path.match(/^\/api\/knowledge\/([^/]+)$/);
		if (knowledgeMatch && method === 'PATCH') {
			const payload = request.postDataJSON() as Record<string, unknown>;
			knowledge = knowledge.map((item) => item.id === knowledgeMatch[1] ? { ...item, title: payload.title ?? item.title, content: payload.content ?? item.content, rating: payload.rating === undefined ? item.rating : payload.rating, filters: payload.filters === undefined && payload.filter_option_ids === undefined ? item.filters : resolveFilters(payloadOptionIds(payload as { filter_option_ids?: string[]; filters?: Array<{ filter_id: string; option_ids: string[] }> })), isActive: payload.is_active ?? item.isActive, updatedAt: new Date().toISOString() } : item);
			return json(route, { item: knowledge.find((item) => item.id === knowledgeMatch[1]) });
		}
		if (knowledgeMatch && method === 'DELETE') { knowledge = knowledge.filter((item) => item.id !== knowledgeMatch[1]); return route.fulfill({ status: 204 }); }
		return json(route, { error: { code: 'E2E_MOCK_MISSING', message: `${method} ${path}`, request_id: 'mock' } }, 500);
	});
	return {
		getConversationCreateCount: () => conversationCreateCount,
		getConversationCount: () => conversations.length,
	};
}
