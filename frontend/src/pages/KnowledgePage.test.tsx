import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast/ToastProvider';
import { KnowledgePage } from './KnowledgePage';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
	listKnowledge: vi.fn(),
	createKnowledgeItem: vi.fn(),
	uploadKnowledgeFile: vi.fn(),
	updateKnowledgeItem: vi.fn(),
	deleteKnowledgeItem: vi.fn(),
	listConversations: vi.fn(), createConversation: vi.fn(), deleteConversation: vi.fn(), renameConversation: vi.fn(),
}));
vi.mock('../api/chatApi', () => api);

const item = {
	id: 'knowledge-1', sourceType: 'manual' as const, title: 'Оффер', content: 'Проверенный текст', mimeType: 'text/plain',
	rating: 5, isActive: true, metadata: {}, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
};

describe('KnowledgePage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listKnowledge.mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasMore: false } });
		api.listConversations.mockResolvedValue([]);
		api.createKnowledgeItem.mockResolvedValue(item);
	});

	it('adds manual text without browser dialogs', async () => {
		render(<MemoryRouter initialEntries={['/knowledge']}><ToastProvider><KnowledgePage user={{ id: 'user', email: 'user@example.com' }} onLogout={vi.fn().mockResolvedValue(undefined)} /></ToastProvider></MemoryRouter>);
		await screen.findByText('Сохранённых данных пока нет');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));
		const dialog = screen.getByRole('dialog');
		fireEvent.change(within(dialog).getByPlaceholderText('Название'), { target: { value: 'Оффер' } });
		fireEvent.change(await within(dialog).findByPlaceholderText('Вставьте текст'), { target: { value: 'Проверенный текст' } });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
		await waitFor(() => expect(api.createKnowledgeItem).toHaveBeenCalledWith('Оффер', 'Проверенный текст', 5, true));
		expect(await screen.findByText('Оффер')).toBeInTheDocument();
	});
});
