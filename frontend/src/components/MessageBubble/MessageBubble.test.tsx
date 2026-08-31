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
		const { container } = render(<MessageBubble message={{ id: 'error-1', role: 'assistant', content: '', status: 'error', error: { code: 'AI_SERVICE_ERROR', title: 'Не удалось получить ответ', description: 'AI-сервис временно недоступен.', requestId: 'request-1', retryable: true } }} onOpenAttachment={vi.fn()} onRetry={onRetry} />);
		expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ');
		expect(screen.getByRole('alert')).toHaveTextContent('request-1');
		fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
		expect(onRetry).toHaveBeenCalledOnce();
		expect(screen.queryByLabelText('Ответ продолжается')).not.toBeInTheDocument();
		expect(container.querySelector('.message--error')).toBeInTheDocument();
		expect(container.querySelector('.message__error')).toBeInTheDocument();
		expect(container.querySelector('.message__error-title')).toBeInTheDocument();
		expect(container.querySelector('.message__error-description')).toBeInTheDocument();
		expect(container.querySelector('.message__error-actions')).toBeInTheDocument();
		expect(container.querySelector('.message--error .message__content')).not.toBeInTheDocument();
	});

	it('renders a complete fallback for an old error without metadata or content', () => {
		const { container } = render(<MessageBubble message={{ id: 'historical-error', role: 'assistant', content: '', status: 'error' }} onOpenAttachment={vi.fn()} onRetry={vi.fn()} />);
		expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ');
		expect(screen.getByRole('alert')).toHaveTextContent('При выполнении запроса произошла ошибка');
		expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
		expect(container.querySelector('.message__error-icon')).toBeInTheDocument();
		expect(container.querySelector('.message__error-actions')).toBeInTheDocument();
	});

	it('recovers an empty historical cancelled row through the dedicated ErrorMessage path', () => {
		const { container } = render(<MessageBubble message={{ id: 'legacy-cancelled', role: 'assistant', content: '', status: 'cancelled' }} onOpenAttachment={vi.fn()} onRetry={vi.fn()} />);
		expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ');
		expect(container.querySelector('.message__error-title')).toBeVisible();
		expect(container.querySelector('.message__error-description')).toBeVisible();
		expect(container.querySelector('.message__content--pending')).not.toBeInTheDocument();
	});

	it('does not render error markup for a completed assistant response', () => {
		const { container } = render(<MessageBubble message={{ id: 'done', role: 'assistant', content: 'Готово', status: 'done' }} onOpenAttachment={vi.fn()} />);
		expect(container.querySelector('.message__error')).not.toBeInTheDocument();
	});

	it('renders a non-empty safe fallback for an unknown persisted error', () => {
		const { container } = render(<MessageBubble message={{ id: 'unknown', role: 'assistant', content: 'raw backend error', status: 'error', errorCode: 'UNKNOWN_PROVIDER_FAILURE' }} onOpenAttachment={vi.fn()} />);
		expect(container.querySelector('.message__error-title')).toHaveTextContent('Не удалось выполнить запрос');
		expect(container.querySelector('.message__error-description')?.textContent?.length).toBeGreaterThan(20);
		expect(screen.getByRole('alert')).not.toHaveTextContent('raw backend error');
	});

	it('allows rating a completed assistant message', () => {
		const onRate = vi.fn();
		render(<MessageBubble message={{ id: 'assistant-2', role: 'assistant', content: 'Ответ', status: 'done' }} onOpenAttachment={vi.fn()} onRate={onRate} onRemoveRating={vi.fn()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		expect(onRate).toHaveBeenCalledWith(5, undefined);
	});

	it('offers generated files for Knowledge and reflects duplicate state', () => {
		const onAdd = vi.fn();
		const { rerender } = render(<MessageBubble
			message={{ id: 'assistant-file', role: 'assistant', content: 'Готово', status: 'done', attachments: [{ id: 'file-1', name: 'script.js', size: 10, type: 'text/javascript', url: '/file', isImage: false, generated: true }] }}
			onOpenAttachment={vi.fn()}
			onAddFileToKnowledge={onAdd}
	/>);
		fireEvent.click(screen.getByRole('button', { name: 'Добавить в базу знаний' }));
		expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }));
		rerender(<MessageBubble
			message={{ id: 'assistant-file', role: 'assistant', content: 'Готово', status: 'done', attachments: [{ id: 'file-1', name: 'script.js', size: 10, type: 'text/javascript', url: '/file', isImage: false, generated: true, knowledgeItemId: 'knowledge-1' }] }}
			onOpenAttachment={vi.fn()}
			onAddFileToKnowledge={onAdd}
	/>);
		expect(screen.getByRole('button', { name: 'В базе знаний' })).toBeDisabled();
	});
});
