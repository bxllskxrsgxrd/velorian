import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from './MessageList';
import { useChatStore } from '../../stores/chatStore';

describe('MessageList branches', () => {
	beforeEach(() => useChatStore.getState().resetConversation());

	it('shows the active edited request and switches to the previous version', async () => {
		const onActivateBranch = vi.fn();
		useChatStore.getState().setMessages([
			{ id: 'u1', role: 'user', content: 'Исходный запрос', branchGroupId: 'u1', isActive: false },
			{ id: 'a1', role: 'assistant', content: 'Старый ответ', replyToId: 'u1' },
			{ id: 'u2', role: 'user', content: 'Изменённый запрос', branchGroupId: 'u1', isActive: true },
			{ id: 'a2', role: 'assistant', content: 'Новый ответ', replyToId: 'u2' },
		]);
		render(
			<MessageList
				onOpenAttachment={vi.fn()}
				onRetry={vi.fn()}
				onEdit={vi.fn()}
				onActivateBranch={onActivateBranch}
				onRate={vi.fn()}
				onRemoveRating={vi.fn()}
				onAddToKnowledge={vi.fn()}
				onOpenKnowledge={vi.fn()}
			/>,
		);

		expect(screen.getByText('Изменённый запрос')).toBeInTheDocument();
		expect(await screen.findByText('Новый ответ')).toBeInTheDocument();
		expect(screen.queryByText('Старый ответ')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Предыдущая версия' }));
		expect(onActivateBranch).toHaveBeenCalledWith('u1');
	});

	it('switches the complete descendant path of an edited request', async () => {
		useChatStore.getState().setMessages([
			{ id: 'u-a', role: 'user', content: 'A', branchGroupId: 'u-a', isActive: true },
			{ id: 'a-a', role: 'assistant', content: 'A response', replyToId: 'u-a' },
			{ id: 'u-b1', role: 'user', content: 'B1', branchGroupId: 'branch-b', isActive: false },
			{ id: 'a-b1', role: 'assistant', content: 'B1 response', replyToId: 'u-b1' },
			{ id: 'u-c', role: 'user', content: 'C', branchGroupId: 'u-c', isActive: true },
			{ id: 'a-c', role: 'assistant', content: 'C response', replyToId: 'u-c' },
			{ id: 'u-d', role: 'user', content: 'D', branchGroupId: 'u-d', isActive: true },
			{ id: 'a-d', role: 'assistant', content: 'D response', replyToId: 'u-d' },
			{ id: 'u-b2', role: 'user', content: 'B2', branchGroupId: 'branch-b', replyToId: 'a-a', isActive: true },
			{ id: 'a-b2', role: 'assistant', content: 'B2 response', replyToId: 'u-b2' },
			{ id: 'u-e', role: 'user', content: 'E', branchGroupId: 'u-e', replyToId: 'a-b2', isActive: true },
			{ id: 'a-e', role: 'assistant', content: 'E response', replyToId: 'u-e' },
			{ id: 'u-f', role: 'user', content: 'F', branchGroupId: 'u-f', replyToId: 'a-e', isActive: true },
			{ id: 'a-f', role: 'assistant', content: 'F response', replyToId: 'u-f' },
		]);
		const onActivateBranch = (messageId: string) => useChatStore.getState().setMessages((messages) =>
			messages.map((message) =>
				message.role === 'user' && message.branchGroupId === 'branch-b'
					? { ...message, isActive: message.id === messageId }
					: message,
			),
		);
		render(
			<MessageList
				onOpenAttachment={vi.fn()}
				onRetry={vi.fn()}
				onEdit={vi.fn()}
				onActivateBranch={onActivateBranch}
				onRate={vi.fn()}
				onRemoveRating={vi.fn()}
				onAddToKnowledge={vi.fn()}
				onOpenKnowledge={vi.fn()}
			/>,
		);

		expect(screen.getByText('B2')).toBeInTheDocument();
		expect(screen.getByText('E')).toBeInTheDocument();
		expect(screen.getByText('F')).toBeInTheDocument();
		expect(screen.queryByText('B1')).not.toBeInTheDocument();
		expect(screen.queryByText('C')).not.toBeInTheDocument();
		expect(screen.queryByText('D')).not.toBeInTheDocument();
		expect(screen.getByText('2 / 2')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Предыдущая версия' }));

		expect(screen.getByText('B1')).toBeInTheDocument();
		expect(screen.getByText('C')).toBeInTheDocument();
		expect(screen.getByText('D')).toBeInTheDocument();
		expect(screen.queryByText('B2')).not.toBeInTheDocument();
		expect(screen.queryByText('E')).not.toBeInTheDocument();
		expect(screen.queryByText('F')).not.toBeInTheDocument();
		expect(screen.getByText('1 / 2')).toBeInTheDocument();
	});
});
