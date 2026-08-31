import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast/ToastProvider';
import { KnowledgePage } from './KnowledgePage';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({
	listKnowledge: vi.fn(),
	createKnowledgeItem: vi.fn(),
	uploadKnowledgeFile: vi.fn(),
	updateKnowledgeItem: vi.fn(),
	deleteKnowledgeItem: vi.fn(),
	listKnowledgeFilters: vi.fn(), createKnowledgeFilter: vi.fn(), createKnowledgeFilterOption: vi.fn(),
	listConversations: vi.fn(), createConversation: vi.fn(), deleteConversation: vi.fn(), renameConversation: vi.fn(),
}));
vi.mock('../api/chatApi', () => api);

const item = {
	id: 'knowledge-1', sourceType: 'manual' as const, title: 'Оффер', content: 'Проверенный текст', mimeType: 'text/plain',
	rating: 5, approach: null, filters: [], isActive: true, metadata: {}, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
};

function LocationProbe() {
	const location = useLocation();
	return <output aria-label="Текущий URL">{location.pathname}{location.search}</output>;
}

function renderKnowledge(initialEntry = '/knowledge') {
	return render(<MemoryRouter initialEntries={[initialEntry]}><ToastProvider><KnowledgePage user={{ id: 'user', email: 'user@example.com' }} onLogout={vi.fn().mockResolvedValue(undefined)} /><LocationProbe /></ToastProvider></MemoryRouter>);
}

describe('KnowledgePage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listKnowledge.mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasMore: false } });
		api.listConversations.mockResolvedValue([]);
		api.listKnowledgeFilters.mockResolvedValue([]);
		api.createKnowledgeItem.mockResolvedValue(item);
		api.updateKnowledgeItem.mockResolvedValue(item);
	});

	it('adds manual text without browser dialogs', async () => {
		renderKnowledge();
		await screen.findByText('Сохранённых данных пока нет');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));
		const dialog = screen.getByRole('dialog');
		fireEvent.change(within(dialog).getByPlaceholderText('Название'), { target: { value: 'Оффер' } });
		fireEvent.change(await within(dialog).findByPlaceholderText('Вставьте текст'), { target: { value: 'Проверенный текст' } });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		fireEvent.click(dialog.querySelector('.modal-dialog__confirm') as HTMLButtonElement);
		await waitFor(() => expect(api.createKnowledgeItem).toHaveBeenCalledWith('Оффер', 'Проверенный текст', 5, true, null, []));
		expect(await screen.findByText('Оффер')).toBeInTheDocument();
	});

	it('resets every filter and removes all query parameters', async () => {
		renderKnowledge('/knowledge?q=hook&source=manual&approach=a1&active=active&rating=4&sort=rating_desc');
		await waitFor(() => expect(api.listKnowledge).toHaveBeenCalled());
		const reset = screen.getByRole('button', { name: 'Сбросить' });
		expect(reset).toBeEnabled();
		fireEvent.click(reset);
		expect(screen.getByLabelText('Текущий URL')).toHaveTextContent('/knowledge');
		expect(screen.getByLabelText('Поиск по базе знаний')).toHaveValue('');
		await waitFor(() => expect(api.listKnowledge).toHaveBeenLastCalledWith(expect.objectContaining({
			search: undefined, sourceType: undefined, filterOptionIds: [], isActive: undefined,
			minRating: undefined, unrated: false, sort: 'date_desc',
		})));
		expect(reset).toBeDisabled();
	});

	it('shows the stored rating in edit mode and saves the changed rating', async () => {
		const stored = { ...item, rating: 4 };
		api.listKnowledge.mockResolvedValue({ items: [stored], pageInfo: { nextCursor: null, hasMore: false } });
		api.updateKnowledgeItem.mockResolvedValue({ ...stored, rating: 5 });
		renderKnowledge();
		fireEvent.click(await screen.findByRole('button', { name: 'Редактировать' }));
		const dialog = screen.getByRole('dialog');
		expect(within(dialog).getByRole('button', { name: 'Поставить рейтинг 4 из 5' })).toHaveAttribute('aria-pressed', 'true');
		expect(dialog.querySelectorAll('.rating__star--active')).toHaveLength(4);
		expect(dialog.querySelectorAll('.rating__star--inactive')).toHaveLength(1);
		fireEvent.click(within(dialog).getByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
		await waitFor(() => expect(api.updateKnowledgeItem).toHaveBeenCalledWith('knowledge-1', expect.objectContaining({ rating: 5, filterOptionIds: [] })));
		expect(await screen.findByRole('img', { name: /Рейтинг Оффер: 5 из 5/ })).toBeInTheDocument();
	});

	it('keeps title separate from Markdown content in edit mode', async () => {
		const markdownContent = '\n**1. Тихий вечер**\n\nОсновной текст.\n';
		const markdownItem = { ...item, title: 'Тихий вечер', content: markdownContent };
		api.listKnowledge.mockResolvedValue({ items: [markdownItem], pageInfo: { nextCursor: null, hasMore: false } });
		api.updateKnowledgeItem.mockResolvedValue(markdownItem);
		renderKnowledge();
		fireEvent.click(await screen.findByRole('button', { name: 'Редактировать' }));
		const dialog = screen.getByRole('dialog');
		expect(within(dialog).getByLabelText('Название')).toHaveValue('Тихий вечер');
		expect(within(dialog).getByLabelText('Содержимое')).toHaveValue(markdownContent);
		expect((within(dialog).getByLabelText('Содержимое') as HTMLTextAreaElement).value).not.toContain('# Тихий вечер');
		fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
		await waitFor(() => expect(api.updateKnowledgeItem).toHaveBeenCalledWith('knowledge-1', expect.objectContaining({ content: markdownContent })));
	});

	it('selects and resets a dynamic custom filter by stable ID', async () => {
		api.listKnowledgeFilters.mockResolvedValue([{ id: 'filter-geo', name: 'ГЕО', slug: 'geo', type: 'single_select', isSystem: false, options: [{ id: 'option-brazil', value: 'Бразилия', normalizedValue: 'бразилия' }], createdAt: '', updatedAt: '' }]);
		renderKnowledge('/knowledge?filter.filter-geo=option-brazil');
		expect(await screen.findByLabelText('ГЕО')).toHaveValue('option-brazil');
		await waitFor(() => expect(api.listKnowledge).toHaveBeenLastCalledWith(expect.objectContaining({ filterOptionIds: ['option-brazil'] })));
		fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
		expect(screen.getByLabelText('Текущий URL')).toHaveTextContent('/knowledge');
	});

	it('saves dynamic metadata selected in the Knowledge form', async () => {
		api.listKnowledgeFilters.mockResolvedValue([{ id: 'filter-geo', name: 'ГЕО', slug: 'geo', type: 'single_select', isSystem: false, options: [{ id: 'option-brazil', value: 'Бразилия', normalizedValue: 'бразилия' }], createdAt: '', updatedAt: '' }]);
		renderKnowledge();
		await screen.findByLabelText('ГЕО');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));
		const dialog = screen.getByRole('dialog');
		fireEvent.change(within(dialog).getByLabelText('Название'), { target: { value: 'Brazil item' } });
		fireEvent.change(within(dialog).getByLabelText('Содержимое'), { target: { value: 'Markdown' } });
		fireEvent.change(within(dialog).getByLabelText('ГЕО элемента'), { target: { value: 'option-brazil' } });
		fireEvent.click(dialog.querySelector('.modal-dialog__confirm') as HTMLButtonElement);
		await waitFor(() => expect(api.createKnowledgeItem).toHaveBeenCalledWith('Brazil item', 'Markdown', null, true, null, ['option-brazil']));
	});
});
