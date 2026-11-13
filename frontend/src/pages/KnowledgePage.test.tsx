import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../components/Toast/ToastProvider';
import { useChatStore } from '../stores/chatStore';
import { useConversationsStore } from '../stores/conversationsStore';
import { useKnowledgeStore } from '../stores/knowledgeStore';
import { useApproachesStore } from '../stores/approachesStore';

import { KnowledgePage } from './KnowledgePage';
import { KnowledgeEditorPage } from './KnowledgeEditorPage';

const api = vi.hoisted(() => ({
	listKnowledge: vi.fn(),
	getKnowledgeItem: vi.fn(),
	createKnowledgeItem: vi.fn(),
	uploadKnowledgeFile: vi.fn(),
	updateKnowledgeFile: vi.fn(),
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
	listApproaches: vi.fn(),
	createKnowledgeApproach: vi.fn(),

	listConversations: vi.fn(),
	createConversation: vi.fn(),
	deleteConversation: vi.fn(),
	renameConversation: vi.fn(),
}));

vi.mock('../api/chatApi', () => api);

// Нужен только для таба предпросмотра
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

function createTextFile(content: string, name: string, type = 'text/plain') {
	const file = new File([content], name, { type });

	// jsdom/File support differs between environments; keep file.text() deterministic
	Object.defineProperty(file, 'text', {
		configurable: true,
		value: vi.fn().mockResolvedValue(content),
	});

	return file;
}

function createFileDataTransfer(file: File) {
	return {
		files: [file],
		items: [
			{
				kind: 'file',
				type: file.type,
				getAsFile: () => file,
			},
		],
		types: ['Files'],
	};
}

const item = {
	id: 'knowledge-1',
	sourceType: 'manual' as const,
	title: 'Тестовый материал',
	content: 'Проверенный текст',
	mimeType: 'text/plain',
	fileName: 'test-material.md',
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

function TestShell() {
	return (
		<ToastProvider>
			<Outlet />
			<LocationProbe />
		</ToastProvider>
	);
}

function renderKnowledge(initialEntry: string | { pathname: string; state: unknown } = '/knowledge') {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: <TestShell />,
				children: [
					{ path: 'knowledge', element: <KnowledgePage user={{ id: 'user', email: 'user@example.com', login: 'user' }} /> },
					{ path: 'knowledge/new', element: <KnowledgeEditorPage /> },
					{ path: 'knowledge/:knowledgeId', element: <KnowledgeEditorPage /> },
					{ path: 'chat/:chatId', element: <div>Чат</div> },
				],
			},
		],
		{ initialEntries: [initialEntry] },
	);
	return render(<RouterProvider router={router} />);
}

async function openEditFromCard(title: string) {
	const cardTitle = await screen.findByText(title, {
		selector: 'strong',
		exact: true,
	});
	const card = cardTitle.closest('article');

	expect(card).not.toBeNull();

	fireEvent.contextMenu(card as HTMLElement, {
		clientX: 100,
		clientY: 100,
	});

	const menu = await screen.findByRole('menu', {
		name: `Действия с записью «${title}»`,
	});

	fireEvent.click(
		within(menu).getByRole('menuitem', {
			name: 'Редактировать',
		}),
	);
}

describe('KnowledgePage', () => {
	beforeEach(() => {
		useKnowledgeStore.getState().reset();
		useChatStore.getState().resetConversation();
		useApproachesStore.getState().reset();
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
		api.listApproaches.mockResolvedValue([]);
		api.getKnowledgeItem.mockResolvedValue(item);

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
		api.updateKnowledgeFile.mockResolvedValue(item);
	});

	it('prefills and saves assistant text with its rating and durable source', async () => {
		const source = {
			type: 'assistant_message' as const,
			messageId: 'assistant-text',
			title: 'Заголовок ответа',
			content: 'Полный текст ответа',
			rating: 4,
			returnTo: '/chat/conversation-1',
		};
		renderKnowledge({ pathname: '/knowledge/new', state: { knowledgeSource: source } });

		expect(await screen.findByRole('textbox', { name: 'Название' })).toHaveValue(source.title);
		expect(screen.getByRole('textbox', { name: 'Содержимое' })).toHaveValue(source.content);
		expect(screen.getByRole('button', { name: 'Поставить рейтинг 4 из 5' })).toHaveAttribute('aria-pressed', 'true');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));

		await waitFor(() => expect(api.createKnowledgeItem).toHaveBeenCalledWith(
			source.title,
			source.content,
			4,
			true,
			null,
			expect.objectContaining({ geo: null, celebrity: null, offer: null, news_source: null }),
			source,
		));
	});

	it('prefills a generated file and preserves an absent rating', async () => {
		const generatedFile = new File(['Тихий шёпот осени\nПродолжение стихотворения.'], 'poem.txt', { type: 'text/plain' });
		const source = {
			type: 'assistant_file' as const,
			messageId: 'assistant-file',
			fileId: 'file-1',
			title: 'poem.txt',
			content: 'Тихий шёпот осени\nПродолжение стихотворения.',
			rating: null,
			fileName: 'poem.txt',
			mimeType: 'text/plain',
			file: generatedFile,
		};
		renderKnowledge({ pathname: '/knowledge/new', state: { knowledgeSource: source } });

		expect(await screen.findByRole('textbox', { name: 'Название' })).toHaveValue('poem.txt');
		expect(screen.getByRole('textbox', { name: 'Содержимое' })).toHaveValue(source.content);
		expect(screen.getByRole('button', { name: 'Выбрать файл' })).toHaveTextContent('poem.txt');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));
		await waitFor(() => expect(api.createKnowledgeItem).toHaveBeenCalledWith(
			source.title,
			source.content,
			null,
			true,
			null,
			expect.any(Object),
			source,
		));
		expect(api.uploadKnowledgeFile).not.toHaveBeenCalled();
	});

	it('returns to the source chat on cancel without creating a record', async () => {
		const source = {
			type: 'assistant_message' as const,
			messageId: 'assistant-cancel',
			title: 'Ответ',
			content: 'Не сохранять',
			rating: null,
			returnTo: '/chat/conversation-1',
		};
		renderKnowledge({ pathname: '/knowledge/new', state: { knowledgeSource: source } });
		fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
		expect(await screen.findByLabelText('Текущий URL')).toHaveTextContent('/chat/conversation-1');
		expect(api.createKnowledgeItem).not.toHaveBeenCalled();
	});

	it('keeps the editor open when linked record creation fails', async () => {
		api.createKnowledgeItem.mockRejectedValueOnce(new Error('Ошибка сохранения'));
		const source = {
			type: 'assistant_message' as const,
			messageId: 'assistant-error',
			title: 'Ответ',
			content: 'Сохранить позже',
			rating: null,
		};
		renderKnowledge({ pathname: '/knowledge/new', state: { knowledgeSource: source } });
		fireEvent.click(await screen.findByRole('button', { name: 'Добавить данные' }));
		expect(await screen.findByText('Ошибка сохранения')).toBeInTheDocument();
		expect(screen.getByLabelText('Текущий URL')).toHaveTextContent('/knowledge/new');
	});

	it('shows created and updated card metadata using full timestamps', async () => {
		api.listKnowledge.mockResolvedValue({
			items: [
				{
					...item,
					id: 'updated-same-day',
					title: 'Изменённая карточка',
					createdAt: '2026-09-09T08:00:00.000Z',
					updatedAt: '2026-09-09T12:00:00.000Z',
				},
				{
					...item,
					id: 'never-updated',
					title: 'Новая карточка',
					createdAt: '2026-09-09T08:00:00.000Z',
					updatedAt: undefined,
				},
				{
					...item,
					id: 'timestamps-match',
					title: 'Неизменённая карточка',
					createdAt: '2026-09-09T08:00:00.000Z',
					updatedAt: '2026-09-09T08:00:00.000Z',
				},
			],
			pageInfo: { nextCursor: null, hasMore: false },
		});

		renderKnowledge();

		const updatedTitle = await screen.findByText('Изменённая карточка', { selector: 'strong' });
		const updatedCard = updatedTitle.closest('article');
		const updatedMetadata = updatedCard?.querySelector<HTMLElement>('.knowledge-card__metadata-summary');
		expect(updatedMetadata).toHaveTextContent('Добавлено вручную · Изменено 09.09.2026');
		expect(within(updatedMetadata as HTMLElement).getByRole('tooltip', { hidden: true })).toHaveTextContent(
			'Добавлено вручнуюСоздано 09.09.2026Изменено 09.09.2026',
		);

		const newTitle = screen.getByText('Новая карточка', { selector: 'strong' });
		const newCard = newTitle.closest('article');
		const newMetadata = newCard?.querySelector<HTMLElement>('.knowledge-card__metadata-summary');
		expect(newMetadata).toHaveTextContent('Добавлено вручную · Создано 09.09.2026');
		expect(within(newMetadata as HTMLElement).getByRole('tooltip', { hidden: true })).toHaveTextContent(
			'Добавлено вручнуюСоздано 09.09.2026',
		);

		const unchangedTitle = screen.getByText('Неизменённая карточка', { selector: 'strong' });
		const unchangedCard = unchangedTitle.closest('article');
		const unchangedMetadata = unchangedCard?.querySelector<HTMLElement>('.knowledge-card__metadata-summary');
		expect(unchangedMetadata).toHaveTextContent('Добавлено вручную · Создано 09.09.2026');
	});

	it('adds manual text without browser dialogs', async () => {
		renderKnowledge();

		await screen.findByText('Сохранённых данных пока нет');

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Добавить данные',
			}),
		);

		const dialog = await screen.findByRole('region', { name: /^(Добавить|Редактировать) данные$/ });

		expect(
			within(dialog).getByRole('tab', {
				name: 'Редактирование',
			}),
		).toHaveAttribute('aria-selected', 'true');

		fireEvent.change(
			within(dialog).getByRole('textbox', {
				name: 'Название',
			}),
			{
				target: {
					value: 'Тестовый материал',
				},
			},
		);

		fireEvent.change(
			within(dialog).getByRole('textbox', {
				name: 'Содержимое',
			}),
			{
				target: {
					value: 'Проверенный текст',
				},
			},
		);

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Поставить рейтинг 5 из 5',
			}),
		);

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Добавить данные',
			}),
		);

		await waitFor(() => {
			expect(api.createKnowledgeItem).toHaveBeenCalledWith('Тестовый материал', 'Проверенный текст', 5, true, null, {
				geo: null,
				celebrity: null,
				offer: null,
				news_source: null,
			});
		});

		await waitFor(() => {
			expect(screen.getByLabelText('Текущий URL')).toHaveTextContent('/knowledge/knowledge-1');
		});
	});

	it('uses the shared inactive card state for disabled knowledge items', async () => {
		api.listKnowledge.mockResolvedValue({
			items: [{ ...item, isActive: false }],
			pageInfo: { nextCursor: null, hasMore: false },
		});

		renderKnowledge();

		const title = await screen.findByText(item.title, { selector: 'strong' });
		expect(title.closest('article')).toHaveClass('knowledge-card--inactive');
	});

	it('updates an existing card through the selected file', async () => {
		api.listKnowledge.mockResolvedValue({
			items: [item],
			pageInfo: { nextCursor: null, hasMore: false },
		});
		const replacement = createTextFile('Новая файловая версия', 'replacement.txt');

		renderKnowledge();
		await openEditFromCard(item.title);

		const dialog = await screen.findByRole('region', { name: /^(Добавить|Редактировать) данные$/ });
		const fileInput = dialog.querySelector<HTMLInputElement>('input[type="file"]');
		expect(fileInput).not.toBeNull();
		const inputClick = vi.spyOn(fileInput as HTMLInputElement, 'click');
		fireEvent.click(within(dialog).getByRole('button', { name: 'Выбрать файл' }));
		expect(inputClick).toHaveBeenCalledOnce();
		fireEvent.change(fileInput as HTMLInputElement, { target: { files: [replacement] } });

		await waitFor(() => {
			expect(within(dialog).getByRole('textbox', { name: 'Содержимое' })).toHaveValue('Новая файловая версия');
		});
		fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

		await waitFor(() => {
			expect(api.updateKnowledgeFile).toHaveBeenCalledWith(
				item.id,
				replacement,
				'replacement.txt',
				'Новая файловая версия',
				item.rating,
				item.isActive,
				null,
				item.filters,
			);
		});
		expect(api.updateKnowledgeItem).not.toHaveBeenCalled();
	});

	it('selects a file dropped into the picker while creating a card', async () => {
		const droppedFile = createTextFile('Текст из перетаскивания', 'dropped.txt');
		const dataTransfer = createFileDataTransfer(droppedFile);

		renderKnowledge();
		await screen.findByText('Сохранённых данных пока нет');
		fireEvent.click(screen.getByRole('button', { name: 'Добавить данные' }));

		const dialog = await screen.findByRole('region', { name: /^(Добавить|Редактировать) данные$/ });
		const dropZone = dialog.querySelector<HTMLElement>('.knowledge-edit-modal__file-drop-zone');
		expect(dropZone).not.toBeNull();
		fireEvent.dragEnter(dropZone as HTMLElement, {
			dataTransfer,
		});
		fireEvent.dragOver(dropZone as HTMLElement, {
			dataTransfer,
		});
		expect(within(dialog).getByRole('button', { name: 'Отпустите файл' })).toBeInTheDocument();
		expect(dropZone?.querySelector('.drop-zone__overlay')).not.toBeInTheDocument();
		fireEvent.dragLeave(dropZone as HTMLElement, {
			dataTransfer,
		});
		expect(within(dialog).getByRole('button', { name: 'Выбрать файл' })).toBeInTheDocument();

		fireEvent.dragEnter(dropZone as HTMLElement, {
			dataTransfer,
		});
		fireEvent.dragOver(dropZone as HTMLElement, {
			dataTransfer,
		});
		fireEvent.drop(dropZone as HTMLElement, {
			dataTransfer,
		});
		expect(within(dialog).getByRole('button', { name: 'Выбрать файл' })).toBeInTheDocument();

		await waitFor(() => {
			expect(within(dialog).getByRole('textbox', { name: 'Название' })).toHaveValue('dropped.txt');
			expect(within(dialog).getByRole('textbox', { name: 'Содержимое' })).toHaveValue('Текст из перетаскивания');
		});

		expect(within(dialog).getByRole('button', { name: 'Убрать файл dropped.txt' })).toBeInTheDocument();
	});

	it('shows manual data in add preview before saving', async () => {
		renderKnowledge();

		await screen.findByText('Сохранённых данных пока нет');

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Добавить данные',
			}),
		);

		const dialog = await screen.findByRole('region', { name: /^(Добавить|Редактировать) данные$/ });

		fireEvent.change(
			within(dialog).getByRole('textbox', {
				name: 'Название',
			}),
			{
				target: {
					value: 'Новый материал',
				},
			},
		);

		fireEvent.change(
			within(dialog).getByRole('textbox', {
				name: 'Содержимое',
			}),
			{
				target: {
					value: 'Текст для предпросмотра',
				},
			},
		);

		const previewTab = within(dialog).getByRole('tab', {
			name: 'Предпросмотр',
		});

		fireEvent.click(previewTab);

		expect(previewTab).toHaveAttribute('aria-selected', 'true');

		const preview = within(dialog).getByRole('tabpanel');

		expect(
			within(preview).getByRole('heading', {
				name: 'Новый материал',
			}),
		).toBeInTheDocument();

		expect(within(preview).getByText(/Добавлено вручную ·/)).toBeInTheDocument();

		expect(await within(preview).findByLabelText('Предпросмотр содержимого')).toHaveValue('Текст для предпросмотра');
	});

	it('combines all four metadata filters in the list request', async () => {
		renderKnowledge('/knowledge?geo=Регион%201&celebrity=Персонаж%201&offer=Предложение%201&news_source=Источник%201');

		await waitFor(() => {
			expect(api.listKnowledge).toHaveBeenCalledWith(
				expect.objectContaining({
					filters: {
						geo: 'Регион 1',
						celebrity: 'Персонаж 1',
						offer: 'Предложение 1',
						news_source: 'Источник 1',
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

	it('sorts knowledge items by activity from the search controls', async () => {
		renderKnowledge();

		fireEvent.click(screen.getByRole('button', { name: 'Сортировка' }));
		fireEvent.click(screen.getByRole('button', { name: 'Сначала активные' }));

		expect(screen.getByLabelText('Текущий URL')).toHaveTextContent('/knowledge?sort=activity_desc');
		await waitFor(() => {
			expect(api.listKnowledge).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'activity_desc' }));
		});
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
		api.getKnowledgeItem.mockResolvedValue(stored);

		renderKnowledge();

		await openEditFromCard('Тестовый материал');

		const dialog = await screen.findByRole('region', { name: /^(Добавить|Редактировать) данные$/ });

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

		expect(dialog.querySelectorAll('.rating__star--active')).toHaveLength(4);

		expect(dialog.querySelectorAll('.rating__star--inactive')).toHaveLength(1);

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Поставить рейтинг 5 из 5',
			}),
		);

		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Сохранить',
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

		expect(within(dialog).getByRole('button', { name: 'Поставить рейтинг 5 из 5' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	it('syncs a successfully saved knowledge rating to the linked chat message', async () => {
		const stored = {
			...item,
			sourceType: 'assistant_message' as const,
			sourceMessageId: 'assistant-linked',
			rating: 4,
		};
		api.getKnowledgeItem.mockResolvedValue(stored);
		api.updateKnowledgeItem.mockResolvedValue({ ...stored, rating: 5 });
		useChatStore.getState().setConversationMessages('conversation-1', [
			{
				id: 'assistant-linked',
				role: 'assistant',
				content: 'Ответ',
				status: 'done',
				knowledgeItem: { id: stored.id, deletedAt: null },
				rating: {
					id: 'rating-1',
					score: 4,
					comment: null,
					createdAt: '2026-08-25T00:00:00Z',
					updatedAt: '2026-08-25T00:00:00Z',
				},
			},
		]);

		renderKnowledge('/knowledge/knowledge-1');
		fireEvent.click(await screen.findByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

		await waitFor(() => {
			expect(useChatStore.getState().messagesByConversation['conversation-1'][0].rating?.score).toBe(5);
		});

		useChatStore.getState().setConversationMessages('conversation-1', [
			{
				id: 'assistant-linked',
				role: 'assistant',
				content: 'Ответ',
				status: 'done',
				knowledgeItem: { id: stored.id, deletedAt: null },
				rating: {
					id: 'rating-1',
					score: 4,
					comment: null,
					createdAt: '2026-08-25T00:00:00Z',
					updatedAt: '2026-08-25T00:00:00Z',
				},
			},
		]);
		expect(useChatStore.getState().messagesByConversation['conversation-1'][0].rating?.score).toBe(5);
	});

	it('keeps the linked chat rating when knowledge saving fails', async () => {
		const stored = {
			...item,
			sourceType: 'assistant_message' as const,
			sourceMessageId: 'assistant-linked',
			rating: 4,
		};
		api.getKnowledgeItem.mockResolvedValue(stored);
		api.updateKnowledgeItem.mockRejectedValueOnce(new Error('Ошибка сохранения'));
		useChatStore.getState().setConversationMessages('conversation-1', [
			{
				id: 'assistant-linked',
				role: 'assistant',
				content: 'Ответ',
				status: 'done',
				knowledgeItem: { id: stored.id, deletedAt: null },
				rating: {
					id: 'rating-1',
					score: 4,
					comment: null,
					createdAt: '2026-08-25T00:00:00Z',
					updatedAt: '2026-08-25T00:00:00Z',
				},
			},
		]);

		renderKnowledge('/knowledge/knowledge-1');
		fireEvent.click(await screen.findByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

		await waitFor(() => expect(api.updateKnowledgeItem).toHaveBeenCalled());
		expect(useChatStore.getState().messagesByConversation['conversation-1'][0].rating?.score).toBe(4);
	});

	it('switches to edit preview and shows only filled metadata', async () => {
		const stored = {
			...item,
			rating: 4,
			filters: {
				geo: 'Регион 1',
				celebrity: null,
				offer: 'Предложение 1',
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
		api.getKnowledgeItem.mockResolvedValue(stored);

		renderKnowledge();

		await openEditFromCard('Тестовый материал');

		const dialog = await screen.findByRole('region', { name: /^(Добавить|Редактировать) данные$/ });

		const editTab = within(dialog).getByRole('tab', {
			name: 'Редактирование',
		});

		const previewTab = within(dialog).getByRole('tab', {
			name: 'Предпросмотр',
		});

		expect(editTab).toHaveAttribute('aria-selected', 'true');
		expect(previewTab).toHaveAttribute('aria-selected', 'false');

		fireEvent.click(previewTab);

		expect(editTab).toHaveAttribute('aria-selected', 'false');
		expect(previewTab).toHaveAttribute('aria-selected', 'true');

		const preview = within(dialog).getByRole('tabpanel');

		expect(
			within(preview).getByRole('heading', {
				name: 'Тестовый материал',
			}),
		).toBeInTheDocument();

		expect(within(preview).getByText('Проверенный текст')).toBeInTheDocument();

		expect(within(preview).getByText('Гео · Регион 1')).toBeInTheDocument();

		expect(within(preview).getByText('Оффер · Предложение 1')).toBeInTheDocument();

		expect(within(preview).queryByText(/Персонаж ·/)).not.toBeInTheDocument();

		expect(within(preview).queryByText(/Источник ·/)).not.toBeInTheDocument();

		expect(within(preview).queryByText(/Подход ·/)).not.toBeInTheDocument();

		expect(within(preview).queryByText('Без подхода')).not.toBeInTheDocument();
	});
});
