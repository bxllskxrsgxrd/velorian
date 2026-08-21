import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';

const api = vi.hoisted(() => ({
	createConversation: vi.fn(),
	deleteConversation: vi.fn(),
	getConversation: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	streamChat: vi.fn(),
}));

vi.mock('../api/chatApi', () => api);

const conversation = {
	id: 'conversation-1',
	title: 'Диалог с ошибкой',
	createdAt: '2026-08-21T00:00:00Z',
	updatedAt: '2026-08-21T00:00:00Z',
};

describe('ChatPage retry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listConversations.mockResolvedValue([conversation]);
		api.getConversation.mockResolvedValue({
			...conversation,
			messages: [
				{ id: 'user-1', role: 'user', content: 'Повтори меня', status: 'done', attachments: [] },
				{ id: 'error-1', role: 'assistant', content: 'Ошибка AI', status: 'error', attachments: [] },
			],
		});
		api.streamChat.mockImplementation(() => new Promise<void>(() => undefined));
	});

	it('adds an optimistic copy of the user message when retry starts', async () => {
		render(<ChatPage user={{ id: 'user', email: 'user@example.com' }} onLogout={vi.fn()} />);

		fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));

		await waitFor(() => expect(screen.getAllByText('Повтори меня')).toHaveLength(2));
		expect(api.streamChat).toHaveBeenCalledWith(expect.objectContaining({ retryMessageId: 'user-1' }));
	});
});
