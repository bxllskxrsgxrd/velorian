import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../components/Toast/ToastProvider';
import { useConversationsStore } from '../stores/conversationsStore';
import { useKnowledgeStore } from '../stores/knowledgeStore';

import { KnowledgePage } from './KnowledgePage';

const api = vi.hoisted(() => ({
	listKnowledge: vi.fn(),
	createKnowledgeItem: vi.fn(),
	uploadKnowledgeFile: vi.fn(),
	updateKnowledgeItem: vi.fn(),
	deleteKnowledgeItem: vi.fn(),

	emptyConversationTrash: vi.fn(),
	emptyKnowledgeTrash: vi.fn(),
	listDeletedConversations: vi.fn(),
	listDeletedKnowledgeItems: vi.fn(),
	permanentlyDeleteConversation: vi.fn(),
	permanentlyDeleteKnowledgeItem: vi.fn(),
	restoreConversation: vi.fn(),
	restoreKnowledgeItem: vi.fn(),

	listKnowledgeApproaches: vi.fn(),
	createKnowledgeApproach: vi.fn(),

	listConversations: vi.fn(),
	createConversation: vi.fn(),
	deleteConversation: vi.fn(),
	renameConversation: vi.fn(),
}));

vi.mock('../api/chatApi', () => api);

/**
 * MarkdownEditor тестируется отдельно.
 * Здесь достаточно простого textarea, чтобы тесты KnowledgePage
 * не зависели от lazy/Suspense и внутренней реализации редактора.
 */
vi.mock('../components/MarkdownEditor/MarkdownEditor', () => ({
	default: ({
		value,
		onChange,
		readonly,
	}: {
		value: string;
		onChange: (value: string) => void;
		readonly?: boolean;
	}) => (
		<textarea
			aria-label={readonly ? 'Предпросмотр содержимого' : 'Редактор содержимого'}
			value={value}
			readOnly={readonly}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

const item = {
	id: 'knowledge-1',
	sourceType: 'manual' as const,
	title: 'Оффер',
	content: 'Проверенный текст',
	mimeType: 'text/plain',
	fileName: 'Оффер.md',
	rating: 5,
	approach: null,
	isActive: true,
	metadata: {},
	filters: {
		geo: null,
		celebrity: null,
		offer: null,
		news_source: null,
	},
	createdAt: '2026-08-25T00:00:00Z',
	updatedAt: '2026-08-25T00:00:00Z',
};

function LocationProbe() {
	const location = useLocation();

	return (
		<output aria-label="Текущий URL">
			{location.pathname}
			{location.search}
		</output>
	);
}

function renderKnowledge(initialEntry = '/knowledge') {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<ToastProvider>
				<KnowledgePage
					user={{ id: 'user', email: 'user@example.com' }}
					onLogout={vi.fn().mockResolvedValue(undefined)}
				/>

				<LocationProbe />
			</ToastProvider>
		</MemoryRouter>,
	);
}

describe('KnowledgePage', () => {
	beforeEach(() => {
		useKnowledgeStore.getState().reset();
		useConversationsStore.getState().reset();

		vi.clearAllMocks();

		api.listKnowledge.mockResolvedValue({
			items: [],
			pageInfo: {
				nextCursor: null,
				hasMore: false,
			},
		});

		api.listConversations.mockResolvedValue([]);
		api.listKnowledgeApproaches.mockResolvedValue([]);

		api.listDeletedConversations.mockResolvedValue([]);
		api.listDeletedKnowledgeItems.mockResolvedValue([]);

		api.emptyConversationTrash.mockResolvedValue(undefined);
		api.emptyKnowledgeTrash.mockResolvedValue(undefined);
		api.permanentlyDeleteConversation.mockResolvedValue(undefined);
		api.permanentlyDeleteKnowledgeItem.mockResolvedValue(undefined);
		api.restoreConversation.mockResolvedValue(undefined);
		api.restoreKnowledgeItem.mockResolvedValue(undefined);

		api.createKnowledgeItem.mockResolvedValue(item);
		api.updateKnowledgeItem.mockResolvedValue(item);
	});

	it('adds manual text without browser dialogs', async () => {
		renderKnowledge();

		await screen.findByText('Сохранённых данных пока нет');

		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));

		const dialog = screen.getByRole('dialog');

		fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название' }), {
			target: { value: 'Оффер' },
		});

		fireEvent.change(await within(dialog).findByLabelText('Редактор содержимого'), {
			target: { value: 'Проверенный текст' },
		});

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Поставить рейтинг 5 из 5',
			}),
		);

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Добавить',
			}),
		);

		await waitFor(() => {
			expect(api.createKnowledgeItem).toHaveBeenCalledWith('Оффер', 'Проверенный текст', 5, true, null, {
				geo: null,
				celebrity: null,
				offer: null,
				news_source: null,
			});
		});

		expect(await screen.findByText('Оффер', { exact: true })).toBeInTheDocument();
	});

	it('combines all four metadata filters in the list request', async () => {
		renderKnowledge('/knowledge?geo=UK&celebrity=Alex&offer=Pixum%20AI&news_source=BBC');

		await waitFor(() => {
			expect(api.listKnowledge).toHaveBeenCalledWith(
				expect.objectContaining({
					filters: {
						geo: 'UK',
						celebrity: 'Alex',
						offer: 'Pixum AI',
						news_source: 'BBC',
					},
				}),
			);
		});
	});

	it('resets filters while preserving search and sorting', async () => {
		renderKnowledge('/knowledge?q=hook&source=manual&approach=a1&active=active&rating=4&sort=rating_desc');

		await waitFor(() => {
			expect(api.listKnowledge).toHaveBeenCalled();
		});

		fireEvent.click(
			screen.getByRole('button', {
				name: /Фильтры/,
			}),
		);

		const reset = screen.getByRole('button', {
			name: 'Сбросить',
		});

		expect(reset).toBeEnabled();

		fireEvent.click(reset);

		expect(screen.getByLabelText('Текущий URL')).toHaveTextContent('/knowledge?q=hook&sort=rating_desc');

		expect(screen.getByLabelText('Поиск по базе знаний')).toHaveValue('hook');

		await waitFor(() => {
			expect(api.listKnowledge).toHaveBeenLastCalledWith(
				expect.objectContaining({
					search: 'hook',
					sourceType: undefined,
					approachId: undefined,
					isActive: undefined,
					minRating: undefined,
					unrated: false,
					sort: 'rating_desc',
					filters: {
						geo: '',
						celebrity: '',
						offer: '',
						news_source: '',
					},
				}),
			);
		});

		expect(reset).toBeDisabled();
	});

	it('shows the stored rating in edit mode and saves the changed rating', async () => {
		const stored = {
			...item,
			rating: 4,
		};

		api.listKnowledge.mockResolvedValue({
			items: [stored],
			pageInfo: {
				nextCursor: null,
				hasMore: false,
			},
		});

		api.updateKnowledgeItem.mockResolvedValue({
			...stored,
			rating: 5,
		});

		renderKnowledge();

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Редактировать',
			}),
		);

		const dialog = screen.getByRole('dialog');

		expect(
			within(dialog).getByRole('tab', {
				name: 'Редактирование',
			}),
		).toHaveAttribute('aria-selected', 'true');

		expect(
			within(dialog).getByRole('button', {
				name: 'Поставить рейтинг 4 из 5',
			}),
		).toHaveAttribute('aria-pressed', 'true');

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Поставить рейтинг 5 из 5',
			}),
		);

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Сохранить изменения',
			}),
		);

		await waitFor(() => {
			expect(api.updateKnowledgeItem).toHaveBeenCalledWith(
				'knowledge-1',
				expect.objectContaining({
					rating: 5,
					approachId: null,
				}),
			);
		});

		expect(
			await screen.findByRole('img', {
				name: /Рейтинг Оффер: 5 из 5/,
			}),
		).toBeInTheDocument();
	});

	it('switches to preview and shows only filled metadata', async () => {
		const stored = {
			...item,
			rating: 4,
			filters: {
				geo: 'UK',
				celebrity: null,
				offer: 'Pixum AI',
				news_source: null,
			},
			approach: null,
		};

		api.listKnowledge.mockResolvedValue({
			items: [stored],
			pageInfo: {
				nextCursor: null,
				hasMore: false,
			},
		});

		renderKnowledge();

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Редактировать',
			}),
		);

		const dialog = screen.getByRole('dialog');

		const previewTab = within(dialog).getByRole('tab', {
			name: 'Предпросмотр',
		});

		expect(previewTab).toHaveAttribute('aria-selected', 'false');

		fireEvent.click(previewTab);

		expect(previewTab).toHaveAttribute('aria-selected', 'true');

		const preview = within(dialog).getByRole('tabpanel');

		expect(within(preview).getByRole('heading', { name: 'Оффер' })).toBeInTheDocument();
		expect(within(preview).getByText('Проверенный текст')).toBeInTheDocument();

		expect(within(preview).getByText('ГЕО · UK')).toBeInTheDocument();
		expect(within(preview).getByText('Оффер · Pixum AI')).toBeInTheDocument();

		expect(within(preview).queryByText(/Селеба ·/)).not.toBeInTheDocument();
		expect(within(preview).queryByText(/Новостник ·/)).not.toBeInTheDocument();
		expect(within(preview).queryByText(/Подход ·/)).not.toBeInTheDocument();
		expect(within(preview).queryByText('Без подхода')).not.toBeInTheDocument();
	});
});
