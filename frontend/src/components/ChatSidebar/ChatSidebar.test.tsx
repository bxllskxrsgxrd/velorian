import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatSidebar } from './ChatSidebar';

const conversation = { id: 'chat-1', title: 'Короткий чат', createdAt: '', updatedAt: '' };

function renderSidebar(isCollapsed = false) {
	const onRename = vi.fn();
	const onDelete = vi.fn();
	const onToggleCollapsed = vi.fn();
	render(
		<ChatSidebar
			user={{ id: 'user', email: 'user@example.com' }}
			conversations={[conversation]}
			activeConversationId="chat-1"
			search=""
			accentTheme="pine"
			isOpen
			isCollapsed={isCollapsed}
			onSearchChange={vi.fn()}
			onSelect={vi.fn()}
			onNew={vi.fn()}
			onDelete={onDelete}
			onRename={onRename}
			onAccentChange={vi.fn()}
			onExport={vi.fn()}
			onLogout={vi.fn()}
			onOpenKnowledge={vi.fn()}
			onClose={vi.fn()}
			onToggleCollapsed={onToggleCollapsed}
		/>,
	);
	return { onRename, onDelete, onToggleCollapsed };
}

describe('ChatSidebar menus', () => {
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
		const { onToggleCollapsed } = renderSidebar(true);
		fireEvent.click(screen.getByRole('button', { name: 'Развернуть панель и найти чат' }));
		expect(onToggleCollapsed).toHaveBeenCalledOnce();
	});
});
