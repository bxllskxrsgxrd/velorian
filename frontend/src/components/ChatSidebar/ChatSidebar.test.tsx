import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSidebar } from './ChatSidebar';

import { useConversationsStore } from '../../stores/conversationsStore';
import { useUiStore } from '../../stores/uiStore';
import { useSidebarStore } from '../../stores/sidebarStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useChatStore } from '../../stores/chatStore';

const api = vi.hoisted(() => ({
	emptyConversationTrash: vi.fn(),
	emptyKnowledgeTrash: vi.fn(),
	listDeletedConversations: vi.fn(),
	listDeletedKnowledgeItems: vi.fn(),
	permanentlyDeleteConversation: vi.fn(),
	permanentlyDeleteKnowledgeItem: vi.fn(),
	restoreConversation: vi.fn(),
	restoreKnowledgeItem: vi.fn(),
}));

vi.mock('../../api/chatApi', () => api);

const conversation = {
	id: 'chat-1',
	title: 'Короткий чат',
	createdAt: '',
	updatedAt: '',
};

function renderSidebar(isCollapsed = false) {
	const onRename = vi.fn();
	const onDelete = vi.fn();
	const onOpenSettings = vi.fn();

	if (useUiStore.getState().isSidebarCollapsed !== isCollapsed) {
		useUiStore.getState().toggleSidebarCollapsed();
	}

	render(
		<ChatSidebar
			user={{ id: 'user', email: 'user@example.com', login: 'user' }}
			activeConversationId="chat-1"
			onSelect={vi.fn()}
			onNew={vi.fn()}
			onDelete={onDelete}
			onRename={onRename}
			onLogout={vi.fn()}
			onOpenKnowledge={vi.fn()}
			onOpenSettings={onOpenSettings}
		/>,
	);

	return { onRename, onDelete, onOpenSettings };
}

describe('ChatSidebar menus', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		api.listDeletedConversations.mockResolvedValue([]);
		api.listDeletedKnowledgeItems.mockResolvedValue([]);

		useConversationsStore.getState().setConversations([conversation]);
		useConversationsStore.getState().setDeletedConversations([]);
		useConversationsStore.getState().setSearch('');

		useKnowledgeStore.getState().setDeletedItems([]);
		useChatStore.getState().resetConversation();

		useSidebarStore.getState().setConversationMenuId(null);
		useSidebarStore.getState().setAccountOpen(false);
		useSidebarStore.getState().setDialog(null);
	});

	it('renames a chat through the custom dialog', () => {
		const { onRename } = renderSidebar();

		fireEvent.click(
			screen.getByRole('button', {
				name: /действия с чатом/i,
			}),
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Переименовать',
			}),
		);

		const input = screen.getByDisplayValue('Короткий чат');

		fireEvent.change(input, {
			target: { value: 'Новое название' },
		});

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Сохранить',
			}),
		);

		expect(onRename).toHaveBeenCalledWith(conversation, 'Новое название');
	});

	it('opens the settings route from the account menu', () => {
		const { onOpenSettings } = renderSidebar();

		fireEvent.click(
			screen.getByRole('button', {
				name: 'user',
			}),
		);

		expect(screen.getByRole('button', { name: 'Настройки' })).toBeInTheDocument();

		expect(screen.getByRole('button', { name: 'Корзина' })).toBeInTheDocument();

		expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Настройки',
			}),
		);

		expect(onOpenSettings).toHaveBeenCalledOnce();
		expect(screen.queryByRole('dialog', { name: 'Общие' })).not.toBeInTheDocument();
	});

	it('opens unified trash with chats and knowledge tabs', async () => {
		const deletedChat = {
			...conversation,
			id: 'deleted-chat',
			title: 'Удалённый чат',
			deletedAt: '2026-09-01T10:00:00Z',
		};

		const deletedKnowledge = {
			id: 'deleted-knowledge',
			sourceType: 'manual',
			title: 'Удалённая запись',
			content: 'Текст',
			mimeType: 'text/markdown',
			fileName: 'deleted.md',
			rating: 4,
			sourceMessageId: 'assistant-linked',
			approach: null,
			isActive: true,
			metadata: {},
			filters: {
				geo: null,
				celebrity: null,
				offer: null,
				news_source: null,
			},
			createdAt: '',
			updatedAt: '',
			deletedAt: '2026-09-02T10:00:00Z',
		};

		api.listDeletedConversations.mockResolvedValue([deletedChat]);
		api.listDeletedKnowledgeItems.mockResolvedValue([deletedKnowledge]);

		api.restoreKnowledgeItem.mockResolvedValue({
			...deletedKnowledge,
			deletedAt: null,
		});
		useChatStore.getState().setConversationMessages('conversation-1', [
			{
				id: 'assistant-linked',
				role: 'assistant',
				content: 'Ответ',
				status: 'done',
				knowledgeItem: { id: 'deleted-knowledge', deletedAt: deletedKnowledge.deletedAt },
				rating: {
					id: 'message-rating',
					score: 2,
					createdAt: '',
					updatedAt: '',
				},
			},
		]);

		renderSidebar();

		fireEvent.click(
			screen.getByRole('button', {
				name: 'user',
			}),
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Корзина',
			}),
		);

		expect(await screen.findByText('Удалённый чат')).toBeInTheDocument();

		expect(
			screen.getByRole('tab', {
				name: 'Чаты (1)',
			}),
		).toHaveAttribute('aria-selected', 'true');

		const knowledgeTab = screen.getByRole('tab', {
			name: 'База знаний (1)',
		});

		fireEvent.click(knowledgeTab);

		expect(knowledgeTab).toHaveAttribute('aria-selected', 'true');

		expect(screen.getByText('Удалённая запись')).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Восстановить',
			}),
		);

		await waitFor(() => {
			expect(api.restoreKnowledgeItem).toHaveBeenCalledWith('deleted-knowledge');
		});

		await waitFor(() => {
			expect(useKnowledgeStore.getState().deletedItems).toEqual([]);

			expect(useKnowledgeStore.getState().items.some((item) => item.id === 'deleted-knowledge')).toBe(true);
		});
		const restoredMessage = useChatStore.getState().messagesByConversation['conversation-1'][0];
		expect(restoredMessage.rating?.score).toBe(4);
		expect(restoredMessage.knowledgeItem).toEqual(expect.objectContaining({
			id: 'deleted-knowledge',
			deletedAt: null,
			rating: 4,
		}));
	});

	it('expands the collapsed sidebar from the search button', () => {
		renderSidebar(true);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Развернуть панель и найти чат',
			}),
		);

		expect(useUiStore.getState().isSidebarCollapsed).toBe(false);
	});
});
