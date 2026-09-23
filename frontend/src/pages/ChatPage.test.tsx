import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { ToastProvider } from '../components/Toast/ToastProvider';
import { ApiError } from '../api/httpClient';
import type { StreamEvent } from '../api/chatApi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useChatStore } from '../stores/chatStore';
import { usePromptStore } from '../stores/promptStore';
import { useFilesStore } from '../stores/filesStore';
import { useConversationsStore } from '../stores/conversationsStore';
import { useMessageUiStore } from '../stores/messageUiStore';
import { AppLayout } from '../components/AppLayout/AppLayout';

const api = vi.hoisted(() => ({
	createConversation: vi.fn(),
	deleteConversation: vi.fn(),
	emptyConversationTrash: vi.fn(),
	emptyKnowledgeTrash: vi.fn(),
	listDeletedConversations: vi.fn(),
	listDeletedKnowledgeItems: vi.fn(),
	permanentlyDeleteConversation: vi.fn(),
	permanentlyDeleteKnowledgeItem: vi.fn(),
	restoreConversation: vi.fn(),
	restoreKnowledgeItem: vi.fn(),
	getConversation: vi.fn(),
	getMessageKnowledgeLink: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	streamChat: vi.fn(),
	activateMessageBranch: vi.fn(),
	createMessageMarkdownFile: vi.fn(),
	removeMessageRating: vi.fn(),
	saveAttachmentToKnowledge: vi.fn(),
	saveMessageToKnowledge: vi.fn(),
	setMessageRating: vi.fn(),
}));

vi.mock('../api/chatApi', () => api);

const conversation = {
	id: 'conversation-1',
	title: 'Диалог с ошибкой',
	createdAt: '2026-08-21T00:00:00Z',
	updatedAt: '2026-08-21T00:00:00Z',
};

function renderChatPage(initialEntry = `/chat/${conversation.id}`) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<ToastProvider>
				<Routes>
					<Route element={<AppLayout user={{ id: 'user', email: 'user@example.com' }} onLogout={vi.fn()} />}>
						<Route path="/chat/:chatId" element={<ChatPage />} />
					</Route>
				</Routes>
			</ToastProvider>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	useChatStore.getState().resetConversation();
	usePromptStore.getState().reset();
	useFilesStore.getState().reset();
	useConversationsStore.getState().reset();
	useMessageUiStore.getState().reset();
});

describe('ChatPage retry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listConversations.mockResolvedValue([conversation]);
		api.getConversation.mockResolvedValue({
			...conversation,
			messages: [
				{ id: 'user-1', role: 'user', content: 'Повтори меня', status: 'done', attachments: [] },
				{ id: 'error-1', role: 'assistant', content: 'Ошибка AI', status: 'error', attachments: [] },
			],
		});
		api.streamChat.mockImplementation(() => new Promise<void>(() => undefined));
	});

	it('adds an optimistic copy of the user message when retry starts', async () => {
		renderChatPage();

		fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));

		const messageList = document.querySelector('.message-list');
		expect(messageList).not.toBeNull();
		await waitFor(() => expect(within(messageList as HTMLElement).getAllByText('Повтори меня')).toHaveLength(2));
		expect(api.streamChat).toHaveBeenCalledWith(expect.objectContaining({ retryMessageId: 'user-1' }));
	});

	it('maps an HTTP failure before stream metadata from pending to the dedicated error UI', async () => {
		api.streamChat.mockRejectedValueOnce(new ApiError('AI_SERVICE_ERROR', 502, 'request-502'));
		const { container } = renderChatPage();

		const prompt = await screen.findByRole('textbox', { name: /введите запрос/i });
		fireEvent.change(prompt, { target: { value: 'Запрос с ошибкой' } });
		fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));

		const safeText = await screen.findByText(/AI-сервис временно недоступен/i);
		const alert = safeText.closest('[role="alert"]');
		expect(alert).not.toBeNull();
		if (!alert) throw new Error('Error UI is missing');
		expect(alert).toHaveTextContent('request-502');
		expect(alert.closest('.message')).toHaveClass('message--error');
		expect(alert.closest('.message')?.querySelector('.message__content')).toBeNull();
		expect(container.querySelector('.message__content--pending')).not.toBeInTheDocument();
	});

	it('maps an error event after stream metadata from streaming to the dedicated error UI', async () => {
		api.getConversation.mockResolvedValueOnce({ ...conversation, messages: [] });
		api.streamChat.mockImplementationOnce(async ({ onEvent }: { onEvent: (event: StreamEvent) => void }) => {
			onEvent({
				type: 'meta',
				conversationId: conversation.id,
				conversationTitle: conversation.title,
				userMessage: { id: 'user-stream', role: 'user', content: 'Потоковая ошибка', status: 'done', attachments: [] },
				assistantMessageId: 'assistant-stream',
				requestId: 'stream-request',
			});
			onEvent({ type: 'delta', content: 'Начало ответа' });
			onEvent({ type: 'error', code: 'AI_TIMEOUT', message: 'internal', requestId: 'timeout-request' });
			throw new ApiError('AI_TIMEOUT', 200, 'timeout-request');
		});
		const { container } = renderChatPage();
		fireEvent.change(await screen.findByRole('textbox', { name: /введите запрос/i }), {
			target: { value: 'Потоковая ошибка' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
		const errorText = await screen.findByText(/Сервер не успел завершить запрос/i);
		const alert = errorText.closest('[role="alert"]');
		expect(alert).not.toBeNull();
		expect(alert?.closest('.message')).toHaveClass('message--error');
		expect(container.querySelector('.message__content--pending')).not.toBeInTheDocument();
	});
});

describe('ChatPage lazy conversation creation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listConversations.mockResolvedValue([conversation]);
		api.streamChat.mockResolvedValue(undefined);
		api.createConversation.mockResolvedValue({ ...conversation, id: 'created-on-send', title: 'Новый чат' });
	});

	it('keeps /chat/new virtual and creates exactly one conversation on the first submit', async () => {
		renderChatPage('/chat/new');
		const prompt = await screen.findByRole('textbox', { name: /введите запрос/i });
		expect(api.createConversation).not.toHaveBeenCalled();
		expect(api.getConversation).not.toHaveBeenCalled();
		fireEvent.change(prompt, { target: { value: 'Первый запрос' } });
		const form = prompt.closest('form');
		if (!form) throw new Error('Prompt form is missing');
		fireEvent.submit(form);
		fireEvent.submit(form);
		await waitFor(() => expect(api.streamChat).toHaveBeenCalledTimes(1));
		expect(api.createConversation).toHaveBeenCalledTimes(1);
		expect(api.streamChat).toHaveBeenCalledWith(
			expect.objectContaining({ conversationId: 'created-on-send', prompt: 'Первый запрос' }),
		);
	});

	it('restores the prompt when creating the first conversation fails', async () => {
		api.createConversation.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 503, 'create-failed'));
		renderChatPage('/chat/new');
		const prompt = await screen.findByRole('textbox', { name: /введите запрос/i });
		fireEvent.change(prompt, { target: { value: 'Не теряй этот текст' } });
		fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
		await waitFor(() => expect(prompt).toHaveValue('Не теряй этот текст'));
		expect(api.streamChat).not.toHaveBeenCalled();
		expect(api.createConversation).toHaveBeenCalledTimes(1);
	});
});

describe('ChatPage conversation deletion', () => {
	it('aborts only the stream owned by the deleted conversation', async () => {
		vi.clearAllMocks();
		const secondConversation = { ...conversation, id: 'conversation-2', title: 'Второй чат' };
		api.listConversations.mockResolvedValue([conversation, secondConversation]);
		api.getConversation.mockImplementation(async (id: string) => ({
			...(id === conversation.id ? conversation : secondConversation),
			messages: [],
		}));
		const signals = new Map<string, AbortSignal>();
		api.streamChat.mockImplementation(({ conversationId, signal }: { conversationId: string; signal: AbortSignal }) => {
			signals.set(conversationId, signal);
			return new Promise<void>(() => undefined);
		});
		api.deleteConversation.mockResolvedValue(undefined);
		renderChatPage();

		const firstPrompt = await screen.findByRole('textbox', { name: /введите запрос/i });
		fireEvent.change(firstPrompt, { target: { value: 'Запрос в первый чат' } });
		fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
		await waitFor(() => expect(signals.has(conversation.id)).toBe(true));

		fireEvent.click(screen.getByRole('button', { name: 'Второй чат' }));
		const secondPrompt = await screen.findByRole('textbox', { name: /введите запрос/i });
		fireEvent.change(secondPrompt, { target: { value: 'Запрос во второй чат' } });
		fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
		await waitFor(() => expect(signals.has(secondConversation.id)).toBe(true));

		fireEvent.click(screen.getByRole('button', { name: `Действия с чатом «${conversation.title}»` }));
		fireEvent.click(screen.getByRole('button', { name: 'В корзину' }));
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Переместить в корзину',
			}),
		);

		await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(conversation.id));
		expect(signals.get(conversation.id)?.aborted).toBe(true);
		expect(signals.get(secondConversation.id)?.aborted).toBe(false);
	});
});
