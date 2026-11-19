import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
	activateMessageBranch,
	createMessageMarkdownFile,
	createConversation,
	getConversation,
	getConversationGeneration,
	getMessageKnowledgeLink,
	listConversations,
	loadAttachmentFile,
	removeMessageRating,
	restoreKnowledgeItem,
	setMessageRating,
	resumeGeneration,
	stopGeneration,
	streamChat,
} from '../api/chatApi';
import type { GenerationSnapshot, StreamEvent } from '../api/chatApi';
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
import { getActiveBranchLeafAssistantId, getMessageParentId } from '../utils/chatBranches';
import { reportError } from '../utils/reportError';
import { splitAssistantResponse } from '../utils/assistantResponse';
import './_chatPage.scss';
import { useToast } from '../hooks/useToast';
import { getUserFacingError } from '../errors/userErrorMessages';

import { ArrowDownIcon, BurgerIcon, CrossIcon } from '../components/icons/AppIcons';
import { useChatStore } from '../stores/chatStore';
import { useConversationsStore } from '../stores/conversationsStore';
import { useFilesStore } from '../stores/filesStore';
import { useModelStore } from '../stores/modelStore';
import { useUiStore } from '../stores/uiStore';

const EMPTY_MESSAGES: ChatMessage[] = [];
const RECONNECT_DELAYS_MS = [0, 750, 2_000, 4_000];

function terminalGenerationError(status: GenerationSnapshot['status'], errorCode?: string | null, requestId?: string | null) {
	const code = status === 'stopped'
		? 'GENERATION_STOPPED'
		: status === 'interrupted'
			? 'GENERATION_INTERRUPTED'
			: (errorCode || 'HISTORICAL_MESSAGE_ERROR');
	return getUserFacingError(code, 0, requestId ?? undefined);
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
	const generation = useChatStore((state) =>
		activeConversationId ? state.generationByConversation[activeConversationId] : undefined,
	);
	const isGenerating = Boolean(generation);
	const setConversationMessages = useChatStore((state) => state.setConversationMessages);
	const syncKnowledgeLink = useChatStore((state) => state.syncKnowledgeLink);
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
	const localRetryPayloadsRef = useRef(new Map<string, { prompt: string; files: File[]; searchMode: SearchMode; modelId: string }>());
	const conversationCreationRef = useRef<Promise<ConversationSummary> | null>(null);
	const locallyCreatedConversationIdsRef = useRef(new Set<string>());
	const sendOperationsRef = useRef(new Map<string, Promise<void>>());
	const previousConversationIdRef = useRef<string | null>(activeConversationId);
	const reconnectSequenceRef = useRef(new Map<string, number>());
	const isMountedRef = useRef(true);
	const [knowledgeRestore, setKnowledgeRestore] = useState<{ messageId: string; itemId: string } | null>(null);
	const { addFiles } = useDragAndDrop(activeConversationId);

	const hasMessages = messages.length > 0;

	function applyGenerationSnapshot(conversationId: string, snapshot: GenerationSnapshot) {
		if (!isMountedRef.current || previousConversationIdRef.current !== conversationId) return;
		const running = snapshot.status === 'queued' || snapshot.status === 'running';
		const nextMessage: ChatMessage = {
			...snapshot.message,
			content: snapshot.content,
			status: running
				? CHAT_MESSAGE_STATUSES.STREAMING
				: snapshot.status === 'completed'
					? CHAT_MESSAGE_STATUSES.DONE
					: CHAT_MESSAGE_STATUSES.ERROR,
			error: running || snapshot.status === 'completed'
				? undefined
				: terminalGenerationError(snapshot.status, snapshot.errorCode, snapshot.requestId),
		};
		setConversationMessages(conversationId, (current) => {
			const exists = current.some((message) => message.id === snapshot.assistantMessageId);
			return exists
				? current.map((message) => message.id === snapshot.assistantMessageId ? nextMessage : message)
				: [...current, nextMessage];
		});
		if (running) {
			setConversationGeneration(conversationId, {
				status: 'running',
				connection: 'reconnecting',
				runId: snapshot.runId,
				assistantMessageId: snapshot.assistantMessageId,
				sequence: snapshot.sequence,
			});
		} else {
			clearConversationGeneration(conversationId);
		}
	}

	function applyReconnectEvent(
		conversationId: string,
		runId: string,
		assistantMessageId: string,
		event: StreamEvent,
	): boolean {
		if (!isMountedRef.current || previousConversationIdRef.current !== conversationId) return false;
		const currentGeneration = useChatStore.getState().generationByConversation[conversationId];
		if (!currentGeneration) return false;
		if (currentGeneration?.runId && currentGeneration.runId !== runId) return false;
		if (event.type === 'snapshot') {
			if (event.generationRunId !== runId || event.assistantMessageId !== assistantMessageId) return false;
			const running = event.status === 'queued' || event.status === 'running';
			setConversationMessages(conversationId, (current) => current.map((message) =>
				message.id === assistantMessageId
					? {
						...message,
						...(event.message ?? {}),
						content: event.content,
						status: running
							? CHAT_MESSAGE_STATUSES.STREAMING
							: event.status === 'completed'
								? CHAT_MESSAGE_STATUSES.DONE
								: CHAT_MESSAGE_STATUSES.ERROR,
						error: running || event.status === 'completed'
							? undefined
							: terminalGenerationError(event.status, event.errorCode, event.requestId),
					}
					: message,
			));
			if (running) {
				setConversationGeneration(conversationId, {
					status: 'running', connection: 'connected', runId,
					assistantMessageId, sequence: event.sequence,
				});
				return false;
			}
			clearConversationGeneration(conversationId);
			return true;
		}
		if (event.type === 'delta') {
			if (event.generationRunId && event.generationRunId !== runId) return false;
			const sequence = event.sequence ?? ((currentGeneration?.sequence ?? 0) + 1);
			if (sequence <= (currentGeneration?.sequence ?? 0)) return false;
			setConversationMessages(conversationId, (current) => current.map((message) =>
				message.id === assistantMessageId
					? { ...message, content: message.content + event.content, status: CHAT_MESSAGE_STATUSES.STREAMING }
					: message,
			));
			setConversationGeneration(conversationId, {
				status: 'running', connection: 'connected', runId, assistantMessageId, sequence,
			});
			return false;
		}
		if (event.type === 'done') {
			setConversationMessages(conversationId, (current) => current.map((message) =>
				message.id === assistantMessageId
					? (event.message ?? { ...message, status: CHAT_MESSAGE_STATUSES.DONE })
					: message,
			));
			clearConversationGeneration(conversationId);
			return true;
		}
		if (event.type === 'error') {
			setConversationMessages(conversationId, (current) => current.map((message) =>
				message.id === assistantMessageId
					? {
						...message,
						status: CHAT_MESSAGE_STATUSES.ERROR,
						error: getUserFacingError(event.code, 0, event.requestId),
					}
					: message,
			));
			clearConversationGeneration(conversationId);
			return true;
		}
		return false;
	}

	async function reconnectGeneration(conversationId: string, initialSnapshot?: GenerationSnapshot) {
		const reconnectSequence = (reconnectSequenceRef.current.get(conversationId) ?? 0) + 1;
		reconnectSequenceRef.current.set(conversationId, reconnectSequence);
		let snapshot = initialSnapshot;
		for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length; attempt += 1) {
			let subscriptionController: AbortController | undefined;
			let terminalReceivedDuringAttempt = false;
			if (
				!isMountedRef.current || previousConversationIdRef.current !== conversationId ||
				reconnectSequenceRef.current.get(conversationId) !== reconnectSequence
			) return;
			if (RECONNECT_DELAYS_MS[attempt] > 0)
				await new Promise((resolve) => window.setTimeout(resolve, RECONNECT_DELAYS_MS[attempt]));
			if (!isMountedRef.current || previousConversationIdRef.current !== conversationId) return;
			try {
				snapshot = snapshot ?? await getConversationGeneration(conversationId) ?? undefined;
				if (!snapshot) {
					clearConversationGeneration(conversationId);
					return;
				}
				applyGenerationSnapshot(conversationId, snapshot);
				if (snapshot.status !== 'queued' && snapshot.status !== 'running') return;
				setConversationGeneration(conversationId, {
					status: 'running', connection: 'reconnecting',
					runId: snapshot.runId, assistantMessageId: snapshot.assistantMessageId, sequence: snapshot.sequence,
				});
				const controller = new AbortController();
				subscriptionController = controller;
				requestControllersRef.current.set(conversationId, controller);
				try {
					await resumeGeneration({
						runId: snapshot.runId,
						conversationId,
						assistantMessageId: snapshot.assistantMessageId,
						signal: controller.signal,
						onEvent: (event) => {
							terminalReceivedDuringAttempt = applyReconnectEvent(
								conversationId, snapshot!.runId, snapshot!.assistantMessageId, event,
							) || terminalReceivedDuringAttempt;
						},
					});
				} finally {
					if (requestControllersRef.current.get(conversationId) === controller)
						requestControllersRef.current.delete(conversationId);
				}
				if (terminalReceivedDuringAttempt || controller.signal.aborted) return;
				snapshot = undefined;
			} catch (error) {
				if (subscriptionController?.signal.aborted || previousConversationIdRef.current !== conversationId) return;
				if (terminalReceivedDuringAttempt) return;
				if (attempt === RECONNECT_DELAYS_MS.length - 1)
					reportError('Не удалось восстановить поток генерации', error, { conversationId });
				snapshot = undefined;
			}
			const current = useChatStore.getState().generationByConversation[conversationId];
			if (current) setConversationGeneration(conversationId, { ...current, connection: 'reconnecting' });
		}
	}
	useEffect(() => {
		const previousId = previousConversationIdRef.current;
		if (previousId && previousId !== activeConversationId) {
			requestControllersRef.current.get(previousId)?.abort();
			reconnectSequenceRef.current.set(previousId, (reconnectSequenceRef.current.get(previousId) ?? 0) + 1);
			clearConversationGeneration(previousId);
		}
		previousConversationIdRef.current = activeConversationId;
	}, [activeConversationId, clearConversationGeneration]);

	useEffect(() => {
		const frameId = requestAnimationFrame(() => {
			const textarea = chatPageRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Введите запрос"]');

			if (!textarea || textarea.disabled) return;
			textarea.focus({ preventScroll: true });
		});

		return () => cancelAnimationFrame(frameId);
	}, [routeConversationId]);

	useEffect(() => {
		if (!activeConversationId) return;
		if (locallyCreatedConversationIdsRef.current.delete(activeConversationId)) {
			setPageError('');
			setIsLoadingConversation(false);
			return;
		}
		const sequence = ++loadSequenceRef.current;
		const messagesAtLoadStart = useChatStore.getState().messagesByConversation[activeConversationId];
		const canApplyLoadedConversation = () => {
			const state = useChatStore.getState();
			return (
				state.messagesByConversation[activeConversationId] === messagesAtLoadStart &&
				!state.generationByConversation[activeConversationId]
			);
		};
		setPageError('');
		setIsLoadingConversation(true);
		getConversation(activeConversationId)
			.then(async (conversation) => {
				if (sequence === loadSequenceRef.current && canApplyLoadedConversation()) {
					setConversationMessages(activeConversationId, conversation.messages);
					try {
						const snapshot = await getConversationGeneration(activeConversationId);
						const currentGeneration = useChatStore.getState().generationByConversation[activeConversationId];
						if (
							sequence === loadSequenceRef.current && snapshot &&
							(!currentGeneration || (currentGeneration.runId && currentGeneration.runId === snapshot.runId))
						) {
							applyGenerationSnapshot(activeConversationId, snapshot);
							if (snapshot.status === 'queued' || snapshot.status === 'running')
								void reconnectGeneration(activeConversationId, snapshot);
						}
					} catch (error) {
						reportError('Не удалось проверить состояние генерации', error, { conversationId: activeConversationId });
					}
				}
			})
			.catch((error: unknown) => {
				reportError('Не удалось открыть диалог', error, { conversationId: activeConversationId });
				if (sequence === loadSequenceRef.current && canApplyLoadedConversation()) {
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
	// Restore is route-scoped; generation callbacks intentionally use the render that started this load.
	// eslint-disable-next-line react-hooks/exhaustive-deps
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
		isMountedRef.current = true;
		const attachmentUrls = attachmentUrlsRef.current;
		const requestControllers = requestControllersRef.current;
		return () => {
			isMountedRef.current = false;
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
				locallyCreatedConversationIdsRef.current.add(created.id);
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
		modelId?: string,
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
		const effectiveModelId = modelId ?? retrySourceMessage?.modelId ?? useModelStore.getState().selectedModelId;
		const parentMessageId = editSourceMessage
			? getMessageParentId(sourceMessages, editSourceMessage.id)
			: getActiveBranchLeafAssistantId(sourceMessages);
		const tempUserId = crypto.randomUUID();
		const tempAttachments = currentFiles.map(createChatAttachment);
		tempAttachments.forEach((attachment) => attachmentUrlsRef.current.add(attachment.url));
		const tempAssistantId = crypto.randomUUID();
		let currentAssistantId: string = tempAssistantId;
		let currentRunId: string | undefined;
		let terminalReceived = false;
		let shouldReconnect = false;
		const controller = new AbortController();
		requestControllersRef.current.set(conversationId, controller);
		setConversationGeneration(conversationId, {
			status: 'running',
			connection: 'connected',
			assistantMessageId: tempAssistantId,
			sequence: 0,
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
			replyToId: parentMessageId,
			isActive: true,
			modelId: effectiveModelId,
		};
		const optimistic: ChatMessage[] = [optimisticUser];
		optimistic.push({
			id: tempAssistantId,
			role: CHAT_ROLES.ASSISTANT,
			content: '',
			status: CHAT_MESSAGE_STATUSES.PENDING,
			replyToId: tempUserId,
			modelId: effectiveModelId,
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
				modelId: effectiveModelId,
				retryMessageId,
				editMessageId,
				signal: controller.signal,
				onEvent: (event) => {
					if (
						!isMountedRef.current || controller.signal.aborted ||
						requestControllersRef.current.get(conversationId) !== controller
					) return;
					if (event.type === 'meta') {
						receivedMeta = true;
						currentRunId = event.generationRunId;
						localRetryPayloadsRef.current.delete(tempUserId);
						currentAssistantId = event.assistantMessageId;
						setConversationGeneration(conversationId, {
							status: 'running',
							connection: 'connected',
							runId: event.generationRunId,
							assistantMessageId: event.assistantMessageId,
							sequence: 0,
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
					} else if (event.type === 'snapshot') {
						if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
						flushDelta();
						currentRunId = event.generationRunId;
						currentAssistantId = event.assistantMessageId;
						terminalReceived = applyReconnectEvent(
							conversationId, event.generationRunId, event.assistantMessageId, event,
						) || terminalReceived;
					} else if (event.type === 'delta') {
						const currentGeneration = useChatStore.getState().generationByConversation[conversationId];
						if (event.sequence !== undefined && event.sequence <= (currentGeneration?.sequence ?? 0)) return;
						pendingDelta += event.content;
						if (currentGeneration) setConversationGeneration(conversationId, {
							...currentGeneration,
							sequence: event.sequence ?? currentGeneration.sequence + 1,
						});
						if (deltaFrame === null) deltaFrame = requestAnimationFrame(flushDelta);
					} else if (event.type === 'done') {
						terminalReceived = true;
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
						terminalReceived = true;
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
			if (receivedMeta && currentRunId && !terminalReceived) shouldReconnect = true;
		} catch (error) {
			if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
			flushDelta();
			const wasDisconnected = controller.signal.aborted;
			if (wasDisconnected) return;
			if (receivedMeta && currentRunId && !terminalReceived) {
				shouldReconnect = true;
				const current = useChatStore.getState().generationByConversation[conversationId];
				if (current) setConversationGeneration(conversationId, { ...current, connection: 'reconnecting' });
				return;
			}
			reportError('Ошибка генерации ответа', error, { conversationId });
			if (!receivedMeta) {
				const normalizedError =
					error instanceof ApiError
						? getUserFacingError(error.code, error.status, error.requestId)
						: getUserFacingError('UNKNOWN_ERROR');
				localRetryPayloadsRef.current.set(tempUserId, {
					prompt: optimisticUser.content,
					files: [...currentFiles],
					searchMode,
					modelId: effectiveModelId,
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
				if (error instanceof ApiError && error.code === 'BRANCH_SUMMARY_UNAVAILABLE') {
					try {
						const conversation = await getConversation(conversationId);
						localRetryPayloadsRef.current.delete(tempUserId);
						setConversationMessages(conversationId, conversation.messages);
					} catch (refreshError) {
						reportError('Не удалось синхронизировать сообщения после ошибки Summary', refreshError, {
							conversationId,
						});
					}
				}
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
								content: '',
								error: message.error ?? normalizedError,
								status: CHAT_MESSAGE_STATUSES.ERROR,
							}
						: message,
				),
			);
		} finally {
			if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
			if (requestControllersRef.current.get(conversationId) === controller) {
				requestControllersRef.current.delete(conversationId);
				if (!shouldReconnect) clearConversationGeneration(conversationId);
			}
			if (shouldReconnect && currentRunId && previousConversationIdRef.current === conversationId)
				void reconnectGeneration(conversationId);
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
			const operation = runStream(
				conversationId,
				prompt,
				currentFiles,
				undefined,
				searchMode,
				undefined,
				useModelStore.getState().selectedModelId,
			);
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

	async function handleStopGeneration() {
		if (!activeConversationId) return;
		const conversationId = activeConversationId;
		let current = useChatStore.getState().generationByConversation[conversationId];
		let snapshot: GenerationSnapshot | null = null;
		if (!current?.runId) {
			for (const delay of [0, 100, 300]) {
				if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
				snapshot = await getConversationGeneration(conversationId);
				if (snapshot && (snapshot.status === 'queued' || snapshot.status === 'running')) break;
			}
			if (snapshot && (snapshot.status === 'queued' || snapshot.status === 'running')) {
				applyGenerationSnapshot(conversationId, snapshot);
				current = useChatStore.getState().generationByConversation[conversationId];
			}
		}
		if (!current) return;
		try {
			const status = await stopGeneration(current.assistantMessageId);
			requestControllersRef.current.get(conversationId)?.abort();
			reconnectSequenceRef.current.set(conversationId, (reconnectSequenceRef.current.get(conversationId) ?? 0) + 1);
			if (status === 'completed' || status === 'failed') {
				const loaded = await getConversation(conversationId);
				setConversationMessages(conversationId, loaded.messages);
			} else {
				setConversationMessages(conversationId, (messages) => messages.map((message) =>
					message.id === current!.assistantMessageId
						? {
							...message,
							status: CHAT_MESSAGE_STATUSES.ERROR,
							error: terminalGenerationError(status),
						}
						: message,
				));
			}
			clearConversationGeneration(conversationId);
		} catch (error) {
			reportError('Не удалось остановить генерацию', error, { conversationId });
			showToast(error instanceof Error ? error.message : 'Не удалось остановить генерацию', 'error');
		}
	}

	function handleRetry(userMessageId: string) {
		if (!activeConversationId) return;
		const localPayload = localRetryPayloadsRef.current.get(userMessageId);
		if (localPayload) {
			void runStream(
				activeConversationId,
				localPayload.prompt,
				localPayload.files,
				undefined,
				localPayload.searchMode,
				undefined,
				localPayload.modelId,
			);
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
		requestControllersRef.current.get(conversationId)?.abort();
		reconnectSequenceRef.current.set(conversationId, (reconnectSequenceRef.current.get(conversationId) ?? 0) + 1);
		clearConversationGeneration(conversationId);
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
		if (item) syncKnowledgeLink(message.id, item);
		else setMessageKnowledgeLink(message.id, null);
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
			let source: KnowledgeCreateSource;
			if (attachment) {
				const file = await loadAttachmentFile(attachment);
				source = {
					type: 'assistant_file',
					messageId: message.id,
					fileId: attachment.id,
					title: attachment.name,
					content: await file.text(),
					rating: message.rating?.score ?? null,
					fileName: attachment.name,
					mimeType: attachment.type,
					file,
					returnTo: `/chat/${activeConversationId}`,
				};
			} else {
				const response = splitAssistantResponse(message.content);
				source = {
					type: 'assistant_message',
					messageId: message.id,
					title: response.title,
					content: response.content,
					rating: message.rating?.score ?? null,
					returnTo: `/chat/${activeConversationId}`,
				};
			}
			navigate('/knowledge/new', { state: { knowledgeSource: source } });
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось открыть редактор базы знаний', 'error');
		}
	}

	async function handleRestoreLinkedKnowledge() {
		if (!knowledgeRestore) return;
		try {
			const restored = await restoreKnowledgeItem(knowledgeRestore.itemId);
			syncKnowledgeLink(knowledgeRestore.messageId, {
				id: restored.id,
				deletedAt: restored.deletedAt,
				rating: restored.rating,
				updatedAt: restored.updatedAt,
			});
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
			const { title } = splitAssistantResponse(message.content);
			const { attachment, created } = await createMessageMarkdownFile(message.id, title);
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
							<BurgerIcon />
						</button>
						<span>{conversations.find((item) => item.id === activeConversationId)?.title ?? 'Новый чат'}</span>
					</header>
					<main className="chat-page__body">
						{pageError && (
							<div className="chat-page__error" role="alert">
								{pageError}
								<button type="button" onClick={() => setPageError('')}>
									<CrossIcon />
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
						{generation?.connection === 'reconnecting' && (
							<div className="chat-page__loading" role="status">Восстанавливаем подключение…</div>
						)}
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
							onStop={() => void handleStopGeneration()}
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
