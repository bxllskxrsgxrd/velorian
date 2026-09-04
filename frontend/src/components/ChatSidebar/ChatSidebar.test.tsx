import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSidebar } from './ChatSidebar';
import { useConversationsStore } from '../../stores/conversationsStore';
import { useUiStore } from '../../stores/uiStore';
import { useSidebarStore } from '../../stores/sidebarStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';

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

const conversation = { id: 'chat-1', title: 'Короткий чат', createdAt: '', updatedAt: '' };

function renderSidebar(isCollapsed = false) {
	const onRename = vi.fn();
	const onDelete = vi.fn();
	if (useUiStore.getState().isSidebarCollapsed !== isCollapsed) {
		useUiStore.getState().toggleSidebarCollapsed();
	}
	render(
		<ChatSidebar
			user={{ id: 'user', email: 'user@example.com' }}
			activeConversationId="chat-1"
			onSelect={vi.fn()}
			onNew={vi.fn()}
			onDelete={onDelete}
			onRename={onRename}
			onExport={vi.fn()}
			onLogout={vi.fn()}
			onOpenKnowledge={vi.fn()}
		/>,
	);
	return { onRename, onDelete };
}

describe('ChatSidebar menus', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listDeletedConversations.mockResolvedValue([]);
		api.listDeletedKnowledgeItems.mockResolvedValue([]);
		useConversationsStore.getState().setConversations([conversation]);
		useConversationsStore.getState().setDeletedConversations([]);
		useKnowledgeStore.getState().setDeletedItems([]);
		useConversationsStore.getState().setSearch('');
		useSidebarStore.getState().setConversationMenuId(null);
		useSidebarStore.getState().setAccountOpen(false);
		useSidebarStore.getState().setSettingsOpen(false);
		useSidebarStore.getState().setDialog(null);
	});

	it('renames a chat through the custom dialog', () => {
		const { onRename } = renderSidebar();
		fireEvent.click(screen.getByRole('button', { name: /действия с чатом/i }));
		fireEvent.click(screen.getByRole('button', { name: 'Переименовать' }));
		const input = screen.getByDisplayValue('Короткий чат');
		fireEvent.change(input, { target: { value: 'Новое название' } });
		fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
		expect(onRename).toHaveBeenCalledWith(conversation, 'Новое название');
	});

	it('keeps accent settings inside the upward account menu', () => {
		renderSidebar();
		fireEvent.click(screen.getByRole('button', { name: /user@example.com/i }));
		fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
		expect(screen.getByText('Акцент интерфейса')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
	});

	it('opens one trash dialog with independent chat and Knowledge tabs', async () => {
		const deletedChat = { ...conversation, id: 'deleted-chat', title: 'Удалённый чат', deletedAt: '2026-09-01T10:00:00Z' };
		const deletedKnowledge = {
			id: 'deleted-knowledge', sourceType: 'manual', title: 'Удалённая запись', content: 'Текст',
			mimeType: 'text/markdown', fileName: 'deleted.md', rating: null, approach: null, isActive: true,
			metadata: {}, filters: { geo: null, celebrity: null, offer: null, news_source: null },
			createdAt: '', updatedAt: '', deletedAt: '2026-09-02T10:00:00Z',
		};
		api.listDeletedConversations.mockResolvedValue([deletedChat]);
		api.listDeletedKnowledgeItems.mockResolvedValue([deletedKnowledge]);
		api.restoreKnowledgeItem.mockResolvedValue({ ...deletedKnowledge, deletedAt: null });
		renderSidebar();

		fireEvent.click(screen.getByRole('button', { name: /user@example.com/i }));
		const accountMenu = screen.getByRole('button', { name: 'Корзина' }).parentElement;
		expect(Array.from(accountMenu?.querySelectorAll(':scope > button') ?? []).map((button) => button.textContent?.trim())).toEqual([
			'Настройки', 'Корзина', 'Выйти',
		]);
		fireEvent.click(screen.getByRole('button', { name: 'Корзина' }));

		expect(await screen.findByText('Удалённый чат')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('tab', { name: /Корзина БД/ }));
		expect(screen.getByText('Удалённая запись')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));
		await waitFor(() => expect(api.restoreKnowledgeItem).toHaveBeenCalledWith('deleted-knowledge'));
		expect(useKnowledgeStore.getState().deletedItems).toEqual([]);
		expect(useKnowledgeStore.getState().items[0].id).toBe('deleted-knowledge');
	});

	it('expands the collapsed sidebar from the search button', () => {
		renderSidebar(true);
		fireEvent.click(screen.getByRole('button', { name: 'Развернуть панель и найти чат' }));
		expect(useUiStore.getState().isSidebarCollapsed).toBe(false);
	});
});
