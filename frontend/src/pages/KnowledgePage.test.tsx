import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast/ToastProvider';
import { KnowledgePage } from './KnowledgePage';

const api = vi.hoisted(() => ({
	listKnowledge: vi.fn(),
	createKnowledgeItem: vi.fn(),
	uploadKnowledgeFile: vi.fn(),
	updateKnowledgeItem: vi.fn(),
	deleteKnowledgeItem: vi.fn(),
}));
vi.mock('../api/chatApi', () => api);

const item = {
	id: 'knowledge-1', sourceType: 'manual' as const, title: 'Оффер', content: 'Проверенный текст', mimeType: 'text/plain',
	isActive: true, metadata: {}, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
};

describe('KnowledgePage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listKnowledge.mockResolvedValue([]);
		api.createKnowledgeItem.mockResolvedValue(item);
	});

	it('adds manual text without browser dialogs', async () => {
		render(<ToastProvider><KnowledgePage user={{ id: 'user', email: 'user@example.com' }} onBack={vi.fn()} /></ToastProvider>);
		await screen.findByText('Сохранённых данных пока нет');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));
		const dialog = screen.getByRole('dialog');
		fireEvent.change(within(dialog).getByPlaceholderText('Название'), { target: { value: 'Оффер' } });
		fireEvent.change(within(dialog).getByPlaceholderText('Вставьте текст'), { target: { value: 'Проверенный текст' } });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
		await waitFor(() => expect(api.createKnowledgeItem).toHaveBeenCalledWith('Оффер', 'Проверенный текст'));
		expect(await screen.findByText('Оффер')).toBeInTheDocument();
	});
});
