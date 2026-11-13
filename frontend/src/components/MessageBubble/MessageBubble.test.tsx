import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBubble } from './MessageBubble';
import { useMessageUiStore } from '../../stores/messageUiStore';

describe('MessageBubble actions', () => {
	const writeText = vi.fn().mockResolvedValue(undefined);

	beforeEach(() => {
		useMessageUiStore.getState().reset();
		writeText.mockClear();
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
	});

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

	it('copies a user message from the action placed before edit', async () => {
		const { container } = render(
			<MessageBubble
				message={{ id: 'user-1', role: 'user', content: 'Текст пользователя', status: 'done' }}
				onOpenAttachment={vi.fn()}
				onEdit={vi.fn()}
			/>,
		);

		const actions = container.querySelector('.message__user-actions');
		expect(actions).not.toBeNull();
		const buttons = within(actions as HTMLElement).getAllByRole('button');
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'Копировать сообщение',
			'Редактировать сообщение',
		]);

		fireEvent.click(buttons[0]);
		await waitFor(() => expect(writeText).toHaveBeenCalledWith('Текст пользователя'));
		expect(screen.getByRole('button', { name: 'Скопировано' })).toBeInTheDocument();
	});

	it('renders a dedicated accessible error state and keeps retry', () => {
		const onRetry = vi.fn();
		const { container } = render(
			<MessageBubble
				message={{
					id: 'error-1',
					role: 'assistant',
					content: '',
					status: 'error',
					error: {
						code: 'AI_SERVICE_ERROR',
						title: 'Не удалось получить ответ',
						description: 'AI-сервис временно недоступен',
						requestId: 'request-1',
						retryable: true,
					},
				}}
				onOpenAttachment={vi.fn()}
				onRetry={onRetry}
			/>,
		);
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
		const { container } = render(
			<MessageBubble
				message={{ id: 'historical-error', role: 'assistant', content: '', status: 'error' }}
				onOpenAttachment={vi.fn()}
				onRetry={vi.fn()}
			/>,
		);
		expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ');
		expect(screen.getByRole('alert')).toHaveTextContent('При выполнении запроса произошла ошибка');
		expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
		expect(container.querySelector('.message__error-icon')).toBeInTheDocument();
		expect(container.querySelector('.message__error-actions')).toBeInTheDocument();
	});

	it('recovers an empty historical cancelled row through the dedicated ErrorMessage path', () => {
		const { container } = render(
			<MessageBubble
				message={{ id: 'legacy-cancelled', role: 'assistant', content: '', status: 'cancelled' }}
				onOpenAttachment={vi.fn()}
				onRetry={vi.fn()}
			/>,
		);
		expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ');
		expect(container.querySelector('.message__error-title')).toBeVisible();
		expect(container.querySelector('.message__error-description')).toBeVisible();
		expect(container.querySelector('.message__content--pending')).not.toBeInTheDocument();
	});

	it('does not render error markup for a completed assistant response', () => {
		const { container } = render(
			<MessageBubble
				message={{ id: 'done', role: 'assistant', content: 'Готово', status: 'done' }}
				onOpenAttachment={vi.fn()}
			/>,
		);
		expect(container.querySelector('.message__error')).not.toBeInTheDocument();
	});

	it('renders a non-empty safe fallback for an unknown persisted error', () => {
		const { container } = render(
			<MessageBubble
				message={{
					id: 'unknown',
					role: 'assistant',
					content: 'raw backend error',
					status: 'error',
					errorCode: 'UNKNOWN_PROVIDER_FAILURE',
				}}
				onOpenAttachment={vi.fn()}
			/>,
		);
		expect(container.querySelector('.message__error-title')).toHaveTextContent('Не удалось выполнить запрос');
		expect(container.querySelector('.message__error-description')?.textContent?.length).toBeGreaterThan(20);
		expect(screen.getByRole('alert')).not.toHaveTextContent('raw backend error');
	});

	it('allows rating a completed assistant message', () => {
		const onRate = vi.fn();
		render(
			<MessageBubble
				message={{ id: 'assistant-2', role: 'assistant', content: 'Ответ', status: 'done' }}
				onOpenAttachment={vi.fn()}
				onRate={onRate}
				onRemoveRating={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		expect(onRate).toHaveBeenCalledWith(5, undefined);
	});

	it('makes the rating read-only while the linked knowledge item is saved', () => {
		const onRate = vi.fn();
		const onRemoveRating = vi.fn();
		render(
			<MessageBubble
				message={{
					id: 'assistant-saved',
					role: 'assistant',
					content: 'Ответ',
					status: 'done',
					knowledgeItem: { id: 'knowledge-1', deletedAt: null },
					rating: {
						id: 'rating-1',
						score: 4,
						createdAt: '2026-09-23T00:00:00Z',
						updatedAt: '2026-09-23T00:00:00Z',
					},
				}}
				onOpenAttachment={vi.fn()}
				onRate={onRate}
				onRemoveRating={onRemoveRating}
				onOpenKnowledge={vi.fn()}
			/>,
		);

		expect(screen.getByRole('img', { name: 'Оценка ответа: 4 из 5' })).toBeVisible();
		expect(screen.queryByRole('button', { name: 'Поставить рейтинг 5 из 5' })).not.toBeInTheDocument();
		expect(onRate).not.toHaveBeenCalled();
		expect(onRemoveRating).not.toHaveBeenCalled();
	});

	it('keeps the stored rating read-only while the linked knowledge item is in trash', () => {
		const onRate = vi.fn();
		const rating = {
			id: 'message-rating',
			score: 4,
			createdAt: '2026-09-22T00:00:00Z',
			updatedAt: '2026-09-23T00:00:00Z',
		};
		const { rerender } = render(
			<MessageBubble
				message={{
					id: 'assistant-trashed',
					role: 'assistant',
					content: 'Ответ',
					status: 'done',
					knowledgeItem: { id: 'knowledge-1', deletedAt: '2026-09-23T00:00:00Z', rating: 4 },
					rating,
				}}
				onOpenAttachment={vi.fn()}
				onRate={onRate}
				onRemoveRating={vi.fn()}
				onOpenKnowledge={vi.fn()}
			/>,
		);

		expect(screen.getByRole('img', { name: 'Оценка ответа: 4 из 5' })).toBeVisible();
		expect(screen.queryByRole('button', { name: 'Поставить рейтинг 5 из 5' })).not.toBeInTheDocument();
		expect(onRate).not.toHaveBeenCalled();

		rerender(
			<MessageBubble
				message={{ id: 'assistant-trashed', role: 'assistant', content: 'Ответ', status: 'done', rating }}
				onOpenAttachment={vi.fn()}
				onRate={onRate}
				onRemoveRating={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Поставить рейтинг 5 из 5' }));
		expect(onRate).toHaveBeenCalledWith(5, undefined);
	});

	it('creates a Markdown file once and exposes progress state', async () => {
		const onCreateFile = vi.fn().mockResolvedValue(undefined);
		render(
			<MessageBubble
				message={{ id: 'assistant-file', role: 'assistant', content: '## Статья', status: 'done' }}
				onOpenAttachment={vi.fn()}
				onCreateFile={onCreateFile}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Создать файл' }));
		expect(onCreateFile).toHaveBeenCalledOnce();
		expect(await screen.findByRole('status')).toHaveTextContent('Файл создан');
		expect(screen.queryByRole('button', { name: 'Файл создан' })).not.toBeInTheDocument();
	});

	it('opens the text editor directly when no generated file exists', () => {
		const onAddToKnowledge = vi.fn();
		render(
			<MessageBubble
				message={{ id: 'assistant-text', role: 'assistant', content: 'Текст ответа', status: 'done' }}
				onOpenAttachment={vi.fn()}
				onAddToKnowledge={onAddToKnowledge}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Добавить текст в базу' }));
		expect(onAddToKnowledge).toHaveBeenCalledWith();
		expect(screen.queryByRole('button', { name: 'Добавить в базу' })).not.toBeInTheDocument();
	});

	it('uses the custom select for text or generated file', () => {
		const onAddToKnowledge = vi.fn();
		const attachment = {
			id: 'generated-file',
			name: 'Ответ.md',
			size: 12,
			type: 'text/markdown',
			url: '/file',
			isImage: false,
			generated: true,
		};
		render(
			<MessageBubble
				message={{
					id: 'assistant-options',
					role: 'assistant',
					content: 'Ответ',
					status: 'done',
					attachments: [attachment],
				}}
				onOpenAttachment={vi.fn()}
				onAddToKnowledge={onAddToKnowledge}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Добавить в базу' }));
		fireEvent.click(screen.getByRole('option', { name: /Текст ответа/ }));
		expect(onAddToKnowledge).toHaveBeenLastCalledWith(undefined);
		fireEvent.click(screen.getByRole('button', { name: 'Добавить в базу' }));
		fireEvent.click(screen.getByRole('option', { name: /Файл «Ответ.md»/ }));
		expect(onAddToKnowledge).toHaveBeenLastCalledWith(attachment);
	});

	it('renders the persisted knowledge state instead of an add action', () => {
		const onOpenKnowledge = vi.fn();
		const { rerender } = render(
			<MessageBubble
				message={{
					id: 'assistant-linked',
					role: 'assistant',
					content: 'Ответ',
					status: 'done',
					knowledgeItem: { id: 'knowledge-1', deletedAt: null },
				}}
				onOpenAttachment={vi.fn()}
				onOpenKnowledge={onOpenKnowledge}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'В базе знаний' }));
		expect(onOpenKnowledge).toHaveBeenCalledOnce();

		rerender(
			<MessageBubble
				message={{
					id: 'assistant-linked',
					role: 'assistant',
					content: 'Ответ',
					status: 'done',
					knowledgeItem: { id: 'knowledge-1', deletedAt: '2026-09-23T00:00:00Z' },
				}}
				onOpenAttachment={vi.fn()}
				onOpenKnowledge={onOpenKnowledge}
			/>,
		);
		expect(screen.getByRole('button', { name: 'В корзине' })).toBeInTheDocument();
	});
});
