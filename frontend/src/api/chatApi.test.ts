import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './chatApi';

afterEach(() => vi.restoreAllMocks());

describe('streamChat', () => {
	it('parses NDJSON events split across network chunks', async () => {
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
});
