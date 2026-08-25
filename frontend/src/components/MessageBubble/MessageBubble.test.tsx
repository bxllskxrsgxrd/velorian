import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';

describe('MessageBubble actions', () => {
	it('does not render message-level copy or speech buttons', () => {
		render(
			<MessageBubble
				message={{ id: 'assistant-1', role: 'assistant', content: 'Обычный ответ', status: 'done' }}
				onOpenAttachment={vi.fn()}
			/>,
		);

		expect(screen.queryByRole('button', { name: /копировать/i })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /озвучить/i })).not.toBeInTheDocument();
	});
});
