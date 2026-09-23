import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
	activateMessageBranch,
	createMessageMarkdownFile,
	createConversation,
	getConversation,
	getMessageKnowledgeLink,
	listConversations,
	removeMessageRating,
	restoreKnowledgeItem,
	setMessageRating,
	streamChat,
} from '../api/chatApi';
import { ApiError } from '../api/httpClient';
import { MessageList } from '../components/MessageList/MessageList';
import { PromptBar } from '../components/PromptBar/PromptBar';
import { RequestMap } from '../components/RequestMap/RequestMap';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { DropZone } from '../components/ui/DropZone/DropZone';
import { CHAT_MESSAGE_STATUSES } from '../constants/chatMessageStatuses';
import { CHAT_ROLES } from '../constants/chatRoles';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import type {
	ChatAttachment,
	ChatMessage,
	ConversationSummary,
	KnowledgeCreateSource,
	SearchMode,
} from '../types/chat';
import { attachmentToPreviewFile, createChatAttachment, fileToPreviewFile } from '../utils/files';
import { reportError } from '../utils/reportError';
import './_chatPage.scss';
import { useToast } from '../hooks/useToast';
import { getUserFacingError } from '../errors/userErrorMessages';

import { ArrowDownIcon } from '../components/icons/AppIcons';
import { useChatStore } from '../stores/chatStore';
import { useConversationsStore } from '../stores/conversationsStore';
import { useFilesStore } from '../stores/filesStore';
import { useUiStore } from '../stores/uiStore';

const EMPTY_MESSAGES: ChatMessage[] = [];

function knowledgeTitle(content: string) {
	return content.split('\n').map((line) => line.trim().replace(/^#+\s*/, '')).find(Boolean)?.slice(0, 255) || 'Ответ ассистента';
}

export function ChatPage() {
	const { showToast } = useToast();
	const navigate = useNavigate();
	const { onExport } = useOutletContext<{ onExport: (format: 'markdown' | 'json') => void }>();
	const { chatId: routeConversationId } = useParams<{ chatId: string }>();
	const isNewConversationRoute = routeConversationId === 'new';
	const conversations = useConversationsStore((state) => state.conversations);
	const setConversations = useConversationsStore((state) => state.setConversations);
	const touchConversation = useConversationsStore((state) => state.touchConversation);
	const activeConversationId = isNewConversationRoute ? null : (routeConversationId ?? null);
	const messages = useChatStore((state) =>
		activeConversationId ? (state.messagesByConversation[activeConversationId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
	);
	const isGenerating = useChatStore((state) =>
		activeConversationId ? Boolean(state.generationByConversation[activeConversationId]) : false,
	);
	const setConversationMessages = useChatStore((state) => state.setConversationMessages);
	const setConversationGeneration = useChatStore((state) => state.setConversationGeneration);
	const clearConversationGeneration = useChatStore((state) => state.clearConversationGeneration);
	const isLoadingConversation = useChatStore((state) => state.isLoadingConversation);
	const setIsLoadingConversation = useChatStore((state) => state.setLoadingConversation);
	const isCreatingConversation = useChatStore((state) => state.isCreatingConversation);
	const pageError = useChatStore((state) => state.pageError);
	const setPageError = useChatStore((state) => state.setPageError);
	const setIsCreatingConversation = useChatStore((state) => state.setCreatingConversation);
	const setPreviewFile = useFilesStore((state) => state.setPreviewFile);
	const setIsSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const showScrollButton = useUiStore((state) => state.showScrollButton);
	const setShowScrollButton = useUiStore((state) => state.setShowScrollButton);
	const chatPageRef = useRef<HTMLDivElement | null>(null);
	const attachmentUrlsRef = useRef(new Set<string>());
	const requestControllersRef = useRef(new Map<string, AbortController>());
	const isNearBottomRef = useRef(true);
	const loadSequenceRef = useRef(0);
	const ratingSequenceRef = useRef(new Map<string, number>());
	const localRetryPayloadsRef = useRef(new Map<string, { prompt: string; files: File[]; searchMode: SearchMode }>());
	const conversationCreationRef = useRef<Promise<ConversationSummary> | null>(null);
	const sendOperationsRef = useRef(new Map<string, Promise<void>>());
	const previousConversationIdRef = useRef<string | null>(activeConversationId);
	const [knowledgeRestore, setKnowledgeRestore] = useState<{ messageId: string; itemId: string } | null>(null);
	const { addFiles } = useDragAndDrop(activeConversationId);

	const hasMessages = messages.length > 0;
	useEffect(() => {
		const previousId = previousConversationIdRef.current;
		if (previousId && previousId !== activeConversationId) requestControllersRef.current.get(previousId)?.abort();
		previousConversationIdRef.current = activeConversationId;
	}, [activeConversationId]);

	useEffect(() => {
		if (!activeConversationId) return;
		const sequence = ++loadSequenceRef.current;
		setPageError('');
		setIsLoadingConversation(true);
		getConversation(activeConversationId)
			.then((conversation) => {
				if (sequence === loadSequenceRef.current) {
					setConversationMessages(activeConversationId, conversation.messages);
				}
			})
			.catch((error: unknown) => {
				reportError('Не удалось открыть диалог', error, { conversationId: activeConversationId });
				if (sequence === loadSequenceRef.current) {
					setConversationMessages(activeConversationId, []);
					setPageError(
						error instanceof ApiError && error.status === 404
							? 'Чат не найден'
							: error instanceof Error
								? error.message
								: 'Не удалось открыть диалог',
					);
				}
			})
			.finally(() => {
				if (sequence === loadSequenceRef.current) setIsLoadingConversation(false);
			});
	}, [activeConversationId, setConversationMessages, setIsLoadingConversation, setPageError]);

	useEffect(() => {
		if (!hasMessages || !isNearBottomRef.current) return;
		const frameId = requestAnimationFrame(() => {
			chatPageRef.current?.scrollTo({
				top: chatPageRef.current.scrollHeight,
				behavior: isGenerating ? 'auto' : 'smooth',
			});
		});
		return () => cancelAnimationFrame(frameId);
	}, [messages, hasMessages, isGenerating]);

	useEffect(() => {
		const attachmentUrls = attachmentUrlsRef.current;
		const requestControllers = requestControllersRef.current;
		return () => {
			requestControllers.forEach((controller) => controller.abort());
			attachmentUrls.forEach((url) => URL.revokeObjectURL(url));
		};
	}, []);

	function handleScroll() {
		const element = chatPageRef.current;
		if (!element) return;
		const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
		isNearBottomRef.current = isNearBottom;
		setShowScrollButton(!isNearBottom);
	}

	function scrollToBottom() {
		isNearBottomRef.current = true;
		setShowScrollButton(false);
		chatPageRef.current?.scrollTo({ top: chatPageRef.current.scrollHeight, behavior: 'smooth' });
	}

	function revokePreviewFile(file: import('../types/chat').PreviewFile | null) {
		if (file?.revokeOnClose) URL.revokeObjectURL(file.url);
	}

	function setNextPreview(next: import('../types/chat').PreviewFile) {
		revokePreviewFile(useFilesStore.getState().previewFile);
		setPreviewFile(next);
	}

	function openPromptFile(file: File) {
		setNextPreview(fileToPreviewFile(file));
	}
	function openMessageAttachment(attachment: ChatAttachment) {
		setNextPreview(attachmentToPreviewFile(attachment));
	}

	function updateConversationSummary(id: string, title?: string) {
		touchConversation(id, title);
	}

	async function ensureConversation() {
		if (activeConversationId) return activeConversationId;
		if (!conversationCreationRef.current) {
			setIsCreatingConversation(true);
			conversationCreationRef.current = createConversation().then((created) => {
				loadSequenceRef.current += 1;
				setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
				setConversationMessages(created.id, []);
				navigate(`/chat/${created.id}`, { replace: true });
				return created;
			});
		}
		try {
			return (await conversationCreationRef.current).id;
		} finally {
			conversationCreationRef.current = null;
			setIsCreatingConversation(false);
		}
	}

	async function runStream(
		conversationId: string,
		prompt = '',
		currentFiles: File[] = [],
		retryMessageId?: string,
		searchMode: SearchMode = 'none',
		editMessageId?: string,
	) {
		if (requestControllersRef.current.has(conversationId)) return;
		setPageError('');
		isNearBottomRef.current = true;
		const sourceMessages = useChatStore.getState().messagesByConversation[conversationId] ?? EMPTY_MESSAGES;

		const retrySourceMessage = retryMessageId
			? sourceMessages.find((message) => message.id === retryMessageId && message.role === CHAT_ROLES.USER)
			: undefined;
		const editSourceMessage = editMessageId
			? sourceMessages.find((message) => message.id === editMessageId && message.role === CHAT_ROLES.USER)
			: undefined;
		const tempUserId = crypto.randomUUID();
		const tempAttachments = currentFiles.map(createChatAttachment);
		tempAttachments.forEach((attachment) => attachmentUrlsRef.current.add(attachment.url));
		const tempAssistantId = crypto.randomUUID();
		let currentAssistantId: string = tempAssistantId;
		const controller = new AbortController();
		requestControllersRef.current.set(conversationId, controller);
		setConversationGeneration(conversationId, {
			status: CHAT_MESSAGE_STATUSES.STREAMING,
			assistantMessageId: tempAssistantId,
		});
		let receivedMeta = false;
		let pendingDelta = '';
		let deltaFrame: number | null = null;
		function flushDelta() {
			if (!pendingDelta) return;
			const content = pendingDelta;
			pendingDelta = '';
			deltaFrame = null;
			setConversationMessages(conversationId, (current) =>
				current.map((message) =>
					message.id === currentAssistantId
						? { ...message, content: message.content + content, status: CHAT_MESSAGE_STATUSES.STREAMING }
						: message,
				),
			);
		}

		const optimisticUser: ChatMessage = {
			id: tempUserId,
			role: CHAT_ROLES.USER,
			content: editSourceMessage ? prompt : (retrySourceMessage?.content ?? prompt),
			attachments: editSourceMessage?.attachments ?? retrySourceMessage?.attachments ?? tempAttachments,
			status: CHAT_MESSAGE_STATUSES.DONE,
			branchGroupId: editSourceMessage ? editSourceMessage.branchGroupId || editSourceMessage.id : tempUserId,
			isActive: true,
		};
		const optimistic: ChatMessage[] = [optimisticUser];
		optimistic.push({
			id: tempAssistantId,
			role: CHAT_ROLES.ASSISTANT,
			content: '',
			status: CHAT_MESSAGE_STATUSES.PENDING,
			replyToId: tempUserId,
		});
		setConversationMessages(conversationId, (current) => [
			...current.map((message) =>
				editSourceMessage &&
				message.role === CHAT_ROLES.USER &&
				(message.branchGroupId || message.id) === (editSourceMessage.branchGroupId || editSourceMessage.id)
					? { ...message, isActive: false }
					: message,
			),
			...optimistic,
		]);

		try {
			await streamChat({
				conversationId,
				prompt,
				files: currentFiles,
				searchMode,
				retryMessageId,
				editMessageId,
				signal: controller.signal,
				onEvent: (event) => {
					if (event.type === 'meta') {
						receivedMeta = true;
						localRetryPayloadsRef.current.delete(tempUserId);
						currentAssistantId = event.assistantMessageId;
						setConversationGeneration(conversationId, {
							status: CHAT_MESSAGE_STATUSES.STREAMING,
							assistantMessageId: event.assistantMessageId,
						});
						tempAttachments.forEach((attachment) => {
							URL.revokeObjectURL(attachment.url);
							attachmentUrlsRef.current.delete(attachment.url);
						});
						setConversationMessages(conversationId, (current) =>
							current.map((message) => {
								if (message.id === tempUserId) return event.userMessage;
								if (message.id === tempAssistantId)
									return {
										...message,
										id: event.assistantMessageId,
										replyToId: event.userMessage.id,
										status: CHAT_MESSAGE_STATUSES.STREAMING,
									};
								return message;
							}),
						);
						updateConversationSummary(event.conversationId, event.conversationTitle);
					} else if (event.type === 'delta') {
						pendingDelta += event.content;
						if (deltaFrame === null) deltaFrame = requestAnimationFrame(flushDelta);
					} else if (event.type === 'done') {
						if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
						flushDelta();
						setConversationMessages(conversationId, (current) =>
							current.map((message) =>
								message.id === currentAssistantId
									? (event.message ?? { ...message, status: CHAT_MESSAGE_STATUSES.DONE })
									: message,
							),
						);
					} else {
						setConversationMessages(conversationId, (current) =>
							current.map((message) =>
								message.id === currentAssistantId
									? {
											...message,
											content: '',
											error: getUserFacingError(event.code, 0, event.requestId),
											status: CHAT_MESSAGE_STATUSES.ERROR,
										}
									: message,
							),
						);
					}
				},
			});
		} catch (error) {
			if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
			flushDelta();
			const wasStopped = controller.signal.aborted;
			if (!wasStopped) reportError('Ошибка генерации ответа', error, { conversationId });
			const messageText = wasStopped ? 'Генерация остановлена' : '';
			if (!receivedMeta) {
				if (wasStopped) {
					setConversationMessages(conversationId, (current) =>
						current.map((message) =>
							message.id === tempAssistantId
								? {
									...message,
									content: message.content || messageText,
									error: undefined,
									status: CHAT_MESSAGE_STATUSES.CANCELLED,
								}
								: message,
						),
					);
					return;
				}
				const normalizedError =
					error instanceof ApiError
						? getUserFacingError(error.code, error.status, error.requestId)
						: getUserFacingError('UNKNOWN_ERROR');
				localRetryPayloadsRef.current.set(tempUserId, {
					prompt: optimisticUser.content,
					files: [...currentFiles],
					searchMode,
				});
				setConversationMessages(conversationId, (current) =>
					current.map((message) =>
						message.id === tempAssistantId
							? {
									...message,
									content: '',
									error: normalizedError,
									status: CHAT_MESSAGE_STATUSES.ERROR,
								}
							: message,
					),
				);
				return;
			}
			const normalizedError =
				error instanceof ApiError
					? getUserFacingError(error.code, error.status, error.requestId)
					: getUserFacingError('UNKNOWN_ERROR');
			setConversationMessages(conversationId, (current) =>
				current.map((message) =>
					message.id === currentAssistantId || message.id === tempAssistantId
						? {
								...message,
								content: wasStopped ? message.content || messageText : '',
								error: wasStopped ? undefined : (message.error ?? normalizedError),
								status: wasStopped ? CHAT_MESSAGE_STATUSES.CANCELLED : CHAT_MESSAGE_STATUSES.ERROR,
							}
						: message,
				),
			);
		} finally {
			if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
			if (requestControllersRef.current.get(conversationId) === controller) {
				requestControllersRef.current.delete(conversationId);
				clearConversationGeneration(conversationId);
			}
			listConversations()
				.then(setConversations)
				.catch((error: unknown) => reportError('Не удалось обновить историю диалогов', error));
		}
	}

	async function handleSendMessage(prompt: string, currentFiles: File[], searchMode: SearchMode) {
		try {
			const conversationId = await ensureConversation();
			const pendingOperation = sendOperationsRef.current.get(conversationId);
			if (pendingOperation) return pendingOperation;
			const operation = runStream(conversationId, prompt, currentFiles, undefined, searchMode);
			sendOperationsRef.current.set(conversationId, operation);
			try {
				await operation;
			} finally {
				if (sendOperationsRef.current.get(conversationId) === operation) {
					sendOperationsRef.current.delete(conversationId);
				}
			}
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось создать чат', 'error');
			throw error;
		}
	}

	function handleRetry(userMessageId: string) {
		if (!activeConversationId) return;
		const localPayload = localRetryPayloadsRef.current.get(userMessageId);
		if (localPayload) {
			void runStream(activeConversationId, localPayload.prompt, localPayload.files, undefined, localPayload.searchMode);
			return;
		}
		void runStream(activeConversationId, '', [], userMessageId);
	}

	function handleEditMessage(message: ChatMessage, content: string) {
		if (activeConversationId) void runStream(activeConversationId, content, [], undefined, 'none', message.id);
	}

	async function handleActivateBranch(messageId: string) {
		if (!activeConversationId) return;
		const conversationId = activeConversationId;
		const active = await activateMessageBranch(messageId);
		const groupId = active.branchGroupId || active.id;
		setConversationMessages(conversationId, (current) =>
			current.map((message) =>
				message.role === CHAT_ROLES.USER && (message.branchGroupId || message.id) === groupId
					? { ...message, isActive: message.id === messageId }
					: message,
			),
		);
	}

	async function handleRateMessage(message: ChatMessage, score: number, comment?: string) {
		if (!activeConversationId) return;
		const conversationId = activeConversationId;
		const sequence = (ratingSequenceRef.current.get(message.id) ?? 0) + 1;
		ratingSequenceRef.current.set(message.id, sequence);
		const previous = message.rating;
		const optimistic = {
			id: previous?.id ?? `rating-${message.id}`,
			score,
			comment: comment || null,
			createdAt: previous?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		setConversationMessages(conversationId, (current) =>
			current.map((entry) => (entry.id === message.id ? { ...entry, rating: optimistic } : entry)),
		);
		try {
			const rating = await setMessageRating(message.id, score, comment);
			if (ratingSequenceRef.current.get(message.id) === sequence)
				setConversationMessages(conversationId, (current) =>
					current.map((entry) => (entry.id === message.id ? { ...entry, rating } : entry)),
				);
		} catch (error) {
			if (ratingSequenceRef.current.get(message.id) === sequence) {
				setConversationMessages(conversationId, (current) =>
					current.map((entry) => (entry.id === message.id ? { ...entry, rating: previous } : entry)),
				);
				showToast(error instanceof Error ? error.message : 'Не удалось сохранить оценку', 'error');
			}
		}
	}

	async function handleRemoveRating(message: ChatMessage) {
		if (!activeConversationId) return;
		const conversationId = activeConversationId;
		const previous = message.rating;
		setConversationMessages(conversationId, (current) =>
			current.map((entry) => (entry.id === message.id ? { ...entry, rating: null } : entry)),
		);
		try {
			await removeMessageRating(message.id);
		} catch (error) {
			setConversationMessages(conversationId, (current) =>
				current.map((entry) => (entry.id === message.id ? { ...entry, rating: previous } : entry)),
			);
			showToast(error instanceof Error ? error.message : 'Не удалось удалить оценку', 'error');
		}
	}

	function setMessageKnowledgeLink(messageId: string, knowledgeItem: ChatMessage['knowledgeItem']) {
		if (!activeConversationId) return;
		setConversationMessages(activeConversationId, (current) =>
			current.map((entry) => (entry.id === messageId ? { ...entry, knowledgeItem } : entry)),
		);
	}

	function openExistingKnowledge(messageId: string, item: NonNullable<ChatMessage['knowledgeItem']>) {
		if (item.deletedAt) setKnowledgeRestore({ messageId, itemId: item.id });
		else navigate(`/knowledge/${item.id}`);
	}

	async function refreshMessageKnowledgeLink(message: ChatMessage) {
		const item = await getMessageKnowledgeLink(message.id);
		setMessageKnowledgeLink(message.id, item);
		return item;
	}

	async function handleOpenKnowledge(message: ChatMessage) {
		try {
			const item = await refreshMessageKnowledgeLink(message);
			if (item) openExistingKnowledge(message.id, item);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось проверить запись базы знаний', 'error');
		}
	}

	async function handleAddToKnowledge(message: ChatMessage, attachment?: ChatAttachment) {
		if (!activeConversationId) return;
		try {
			const existing = await refreshMessageKnowledgeLink(message);
			if (existing) {
				openExistingKnowledge(message.id, existing);
				return;
			}
			const source: KnowledgeCreateSource = {
				type: attachment ? 'assistant_file' : 'assistant_message',
				messageId: message.id,
				fileId: attachment?.id,
				title: attachment?.name ?? knowledgeTitle(message.content),
				content: message.content,
				rating: message.rating?.score ?? null,
				fileName: attachment?.name,
				mimeType: attachment?.type,
				returnTo: `/chat/${activeConversationId}`,
			};
			navigate('/knowledge/new', { state: { knowledgeSource: source } });
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось открыть редактор базы знаний', 'error');
		}
	}

	async function handleRestoreLinkedKnowledge() {
		if (!knowledgeRestore) return;
		try {
			const restored = await restoreKnowledgeItem(knowledgeRestore.itemId);
			setMessageKnowledgeLink(knowledgeRestore.messageId, { id: restored.id, deletedAt: null });
			setKnowledgeRestore(null);
			showToast('Запись базы знаний восстановлена', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось восстановить запись', 'error');
		}
	}

	async function handleCreateFile(message: ChatMessage) {
		if (!activeConversationId) return;
		const conversationId = activeConversationId;
		try {
			const { attachment, created } = await createMessageMarkdownFile(message.id);
			setConversationMessages(conversationId, (current) =>
				current.map((entry) =>
					entry.id === message.id
						? {
								...entry,
								attachments: [...(entry.attachments ?? []).filter((item) => item.id !== attachment.id), attachment],
							}
						: entry,
				),
			);
			showToast(created ? 'Markdown-файл создан' : 'Файл для этого ответа уже создан', created ? 'success' : 'info');
		} catch (error) {
			reportError('MESSAGE_MARKDOWN_FILE_FAILED', error, { messageId: message.id });
			showToast(error instanceof Error ? error.message : 'Не удалось создать файл', 'error');
			throw error;
		}
	}

	function reportActionError(error: unknown, fallback: string) {
		reportError(fallback, error);
		setPageError(error instanceof Error ? error.message : fallback);
	}

	return (
		<div className="chat-shell">
			<DropZone onFilesDrop={addFiles}>
				<div
					ref={chatPageRef}
					onScroll={handleScroll}
					className={hasMessages ? 'chat-page chat-page--chat' : 'chat-page chat-page--start'}
				>
					<header className="chat-page__topbar">
						<button type="button" onClick={() => setIsSidebarOpen(true)} aria-label="Открыть историю">
							☰
						</button>
						<span>{conversations.find((item) => item.id === activeConversationId)?.title ?? 'Новый чат'}</span>
					</header>
					<main className="chat-page__body">
						{pageError && (
							<div className="chat-page__error" role="alert">
								{pageError}
								<button type="button" onClick={() => setPageError('')}>
									×
								</button>
							</div>
						)}
						{isLoadingConversation ? (
							<div className="chat-page__loading">Загрузка диалога…</div>
						) : hasMessages ? (
							<MessageList
								conversationId={activeConversationId}
								onOpenAttachment={openMessageAttachment}
								onRetry={handleRetry}
								onEdit={handleEditMessage}
								canEdit={!isGenerating}
								onActivateBranch={(messageId) =>
									void handleActivateBranch(messageId).catch((error: unknown) =>
										reportActionError(error, 'Не удалось переключить версию'),
									)
								}
								onRate={(message, score, comment) => void handleRateMessage(message, score, comment)}
								onRemoveRating={(message) => void handleRemoveRating(message)}
								onAddToKnowledge={(message, attachment) => void handleAddToKnowledge(message, attachment)}
								onOpenKnowledge={(message) => void handleOpenKnowledge(message)}
								onCreateFile={handleCreateFile}
							/>
						) : (
							<div className="chat-page__start">
								<h1 className="chat-page__heading">Введи запрос</h1>
							</div>
						)}
					</main>
					<div className="chat-page__prompt">
						{showScrollButton && (
							<button
								className="chat-page__scroll-bottom"
								type="button"
								onClick={scrollToBottom}
								aria-label="К новым сообщениям"
							>
								<ArrowDownIcon />
							</button>
						)}
						<PromptBar
							onSendMessage={handleSendMessage}
							onExport={onExport}
							onStop={() => {
								if (activeConversationId) requestControllersRef.current.get(activeConversationId)?.abort();
							}}
							onOpenFile={openPromptFile}
							isGenerating={isGenerating || isCreatingConversation}
							submissionKey={activeConversationId ?? 'new'}
						/>
					</div>
				</div>
			</DropZone>
			<RequestMap conversationId={activeConversationId} />
			{knowledgeRestore && (
				<ModalDialog
					title="Запись находится в корзине"
					confirmLabel="Восстановить"
					onClose={() => setKnowledgeRestore(null)}
					onConfirm={() => void handleRestoreLinkedKnowledge()}
				>
					<p>Восстановить связанную запись базы знаний?</p>
				</ModalDialog>
			)}
		</div>
	);
}
