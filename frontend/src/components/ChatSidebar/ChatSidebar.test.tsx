import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSidebar } from './ChatSidebar';
import { useConversationsStore } from '../../stores/conversationsStore';
import { useUiStore } from '../../stores/uiStore';
import { useSidebarStore } from '../../stores/sidebarStore';

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
		useConversationsStore.getState().setConversations([conversation]);
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

	it('expands the collapsed sidebar from the search button', () => {
		renderSidebar(true);
		fireEvent.click(screen.getByRole('button', { name: 'Развернуть панель и найти чат' }));
		expect(useUiStore.getState().isSidebarCollapsed).toBe(false);
	});
});
