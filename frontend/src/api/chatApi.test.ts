import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversation, streamChat } from './chatApi';
import { setCsrfToken } from './httpClient';

afterEach(() => vi.restoreAllMocks());

describe('streamChat', () => {
	it('parses NDJSON events split across network chunks', async () => {
		setCsrfToken('test-csrf');
		const encoder = new TextEncoder();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"type":"delta","content":"При"'));
				controller.enqueue(encoder.encode('}\n{"type":"delta","content":"вет"}\n{"type":"done","messageId":"a"}\n'));
				controller.close();
			},
		});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
		const events: string[] = [];
		await streamChat({
			conversationId: 'c',
			signal: new AbortController().signal,
			onEvent: (event) => events.push(event.type),
		});
		expect(events).toEqual(['delta', 'delta', 'done']);
	});

	it('adds CSRF and request correlation headers to mutations', async () => {
		setCsrfToken('csrf-value');
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ conversation: { id: 'c', title: 'Чат', createdAt: '', updatedAt: '' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
		await createConversation('Чат');
		expect(fetchMock).toHaveBeenCalledWith('/api/conversations', expect.objectContaining({
			method: 'POST',
			headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-value', 'X-Request-ID': expect.any(String) }),
		}));
	});

	it('sends knowledge search as an implementation-independent search mode', async () => {
		setCsrfToken('test-csrf');
		const encoder = new TextEncoder();
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"type":"done","messageId":"a"}\n')); controller.close(); } }), { status: 200 }));
		await streamChat({ conversationId: 'c', searchMode: 'knowledge', signal: new AbortController().signal, onEvent: vi.fn() });
		const body = fetchMock.mock.calls[0][1]?.body as FormData;
		expect(body.get('search_mode')).toBe('knowledge');
		expect(body.has('userId')).toBe(false);
	});
});
