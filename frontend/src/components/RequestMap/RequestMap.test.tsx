import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { RequestMap } from './RequestMap';

describe('RequestMap', () => {
	beforeEach(() => useChatStore.getState().resetConversation());

	it('keeps identical requests separate and groups only real message versions', () => {
		useChatStore.getState().setMessages([
			{ id: 'u1', role: 'user', content: 'прив' },
			{ id: 'u2', role: 'user', content: 'прив' },
			{ id: 'u3', role: 'user', content: 'как было', branchGroupId: 'branch-1', isActive: false },
			{ id: 'u4', role: 'user', content: 'как дела', branchGroupId: 'branch-1', isActive: true },
		]);

		render(
			<>
				<main className="chat-page">
					<div id="message-u1" />
					<div id="message-u2" />
					<div id="message-u4" />
				</main>
				<RequestMap />
			</>,
		);

		expect(screen.getAllByRole('button', { name: 'прив' })).toHaveLength(2);
		expect(screen.getByRole('button', { name: '2/2 как дела' })).toBeInTheDocument();
		expect(screen.queryByText('как было')).not.toBeInTheDocument();
	});

	it('marks the list as scrollable only when it contains more than eight requests', () => {
		useChatStore.getState().setMessages(
			Array.from({ length: 9 }, (_, index) => ({
				id: `u${index}`,
				role: 'user' as const,
				content: `Запрос ${index + 1}`,
			})),
		);

		const { container } = render(<RequestMap />);

		expect(container.querySelector('.request-map')).toHaveClass('request-map--scrollable');
	});
});
