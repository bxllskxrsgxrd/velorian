import { fireEvent, render, screen } from '@testing-library/react';
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

	it('renders a dedicated accessible error state and keeps retry', () => {
		const onRetry = vi.fn();
		render(<MessageBubble message={{ id: 'error-1', role: 'assistant', content: 'Сервис временно недоступен', status: 'error', requestId: 'request-1' }} onOpenAttachment={vi.fn()} onRetry={onRetry} />);
		expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ');
		expect(screen.getByRole('alert')).toHaveTextContent('request-1');
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
		expect(onRetry).toHaveBeenCalledOnce();
		expect(screen.queryByLabelText('Ответ продолжается')).not.toBeInTheDocument();
	});

	it('allows rating a completed assistant message', () => {
		const onRate = vi.fn();
		render(<MessageBubble message={{ id: 'assistant-2', role: 'assistant', content: 'Ответ', status: 'done' }} onOpenAttachment={vi.fn()} onRate={onRate} onRemoveRating={vi.fn()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Оценка 5 из 5' }));
		expect(onRate).toHaveBeenCalledWith(5, undefined);
	});
});
