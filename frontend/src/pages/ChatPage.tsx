import { useEffect, useMemo, useRef, useState } from 'react';
import {
	createConversation,
	deleteConversation,
	getConversation,
	listConversations,
	renameConversation,
	streamChat,
} from '../api/chatApi';
import { ChatSidebar } from '../components/ChatSidebar/ChatSidebar';
import { FilePreviewModal } from '../components/FilePreviewModal/FilePreviewModal';
import { MessageList } from '../components/MessageList/MessageList';
import { PromptBar } from '../components/PromptBar/PromptBar';
import { DropZone } from '../components/ui/DropZone/DropZone';
import { CHAT_MESSAGE_STATUSES } from '../constants/chatMessageStatuses';
import { CHAT_ROLES } from '../constants/chatRoles';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { getStoredAccentTheme, setAccentTheme, type AccentTheme } from '../theme/accentTheme';
import type { AuthUser, ChatAttachment, ChatMessage, ConversationSummary, PreviewFile } from '../types/chat';
import { attachmentToPreviewFile, createChatAttachment, fileToPreviewFile } from '../utils/files';
import { reportError } from '../utils/reportError';
import './_chatPage.scss';
import { ArrowDownIcon } from '../components/icons/ArrowDownIcon';

type ChatPageProps = {
	user: AuthUser;
	onLogout: () => Promise<void>;
};

function downloadText(name: string, content: string, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

export function ChatPage({ user, onLogout }: ChatPageProps) {
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isLoadingConversation, setIsLoadingConversation] = useState(false);
	const [pageError, setPageError] = useState('');
	const [conversationSearch, setConversationSearch] = useState('');
	const [accent, setAccent] = useState<AccentTheme>(getStoredAccentTheme);
	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [showScrollButton, setShowScrollButton] = useState(false);
	const chatPageRef = useRef<HTMLDivElement | null>(null);
	const attachmentUrlsRef = useRef(new Set<string>());
	const previewFileRef = useRef<PreviewFile | null>(null);
	const requestControllerRef = useRef<AbortController | null>(null);
	const isNearBottomRef = useRef(true);
	const loadSequenceRef = useRef(0);
	const skipNextLoadRef = useRef(false);

	const {
		isDragging,
		files,
		fileError,
		addFiles,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		removeFile,
		clearFiles,
	} = useDragAndDrop();

	const hasMessages = messages.length > 0;
	const filteredConversations = useMemo(() => {
		const query = conversationSearch.trim().toLocaleLowerCase('ru');
		return query ? conversations.filter((item) => item.title.toLocaleLowerCase('ru').includes(query)) : conversations;
	}, [conversationSearch, conversations]);

	useEffect(() => {
		let cancelled = false;
		listConversations()
			.then((items) => {
				if (cancelled) return;
				setConversations(items);
				if (items[0]) setActiveConversationId(items[0].id);
			})
			.catch((error: unknown) => {
				reportError('Не удалось загрузить историю диалогов', error);
				if (!cancelled) setPageError(error instanceof Error ? error.message : 'Не удалось загрузить историю');
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!activeConversationId) return;
		if (skipNextLoadRef.current) {
			skipNextLoadRef.current = false;
			return;
		}
		const sequence = ++loadSequenceRef.current;
		setIsLoadingConversation(true);
		getConversation(activeConversationId)
			.then((conversation) => {
				if (sequence === loadSequenceRef.current) {
					attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
					attachmentUrlsRef.current.clear();
					setMessages(conversation.messages);
				}
			})
			.catch((error: unknown) => {
				reportError('Не удалось открыть диалог', error, { conversationId: activeConversationId });
				if (sequence === loadSequenceRef.current)
					setPageError(error instanceof Error ? error.message : 'Не удалось открыть диалог');
			})
			.finally(() => {
				if (sequence === loadSequenceRef.current) setIsLoadingConversation(false);
			});
	}, [activeConversationId]);

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
		return () => {
			requestControllerRef.current?.abort();
			attachmentUrls.forEach((url) => URL.revokeObjectURL(url));
			if (previewFileRef.current?.revokeOnClose) URL.revokeObjectURL(previewFileRef.current.url);
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

	function revokePreviewFile(file: PreviewFile | null) {
		if (file?.revokeOnClose) URL.revokeObjectURL(file.url);
	}

	function revokeLocalAttachmentUrls() {
		attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
		attachmentUrlsRef.current.clear();
	}

	function setNextPreview(next: PreviewFile) {
		revokePreviewFile(previewFileRef.current);
		previewFileRef.current = next;
		setPreviewFile(next);
	}

	function openPromptFile(file: File) {
		setNextPreview(fileToPreviewFile(file));
	}
	function openMessageAttachment(attachment: ChatAttachment) {
		setNextPreview(attachmentToPreviewFile(attachment));
	}
	function closePreview() {
		revokePreviewFile(previewFileRef.current);
		previewFileRef.current = null;
		setPreviewFile(null);
	}

	function updateConversationSummary(id: string, title?: string) {
		const now = new Date().toISOString();
		setConversations((current) => {
			const found = current.find((item) => item.id === id);
			if (!found) return current;
			const updated = { ...found, title: title ?? found.title, updatedAt: now };
			return [updated, ...current.filter((item) => item.id !== id)];
		});
	}

	async function ensureConversation() {
		if (activeConversationId) return activeConversationId;
		const created = await createConversation();
		loadSequenceRef.current += 1;
		skipNextLoadRef.current = true;
		setConversations((current) => [created, ...current]);
		setActiveConversationId(created.id);
		setMessages([]);
		return created.id;
	}

	async function runStream(
		conversationId: string,
		prompt = '',
		currentFiles: File[] = [],
		retryMessageId?: string,
		webSearch = false,
	) {
		if (isGenerating) return;
		setPageError('');
		setIsGenerating(true);
		isNearBottomRef.current = true;

		const retrySourceMessage = retryMessageId
			? messages.find((message) => message.id === retryMessageId && message.role === CHAT_ROLES.USER)
			: undefined;
		const tempUserId = crypto.randomUUID();
		const tempAttachments = currentFiles.map(createChatAttachment);
		tempAttachments.forEach((attachment) => attachmentUrlsRef.current.add(attachment.url));
		const tempAssistantId = crypto.randomUUID();
		let currentAssistantId: string = tempAssistantId;
		let receivedMeta = false;
		let pendingDelta = '';
		let deltaFrame: number | null = null;
		function flushDelta() {
			if (!pendingDelta) return;
			const content = pendingDelta;
			pendingDelta = '';
			deltaFrame = null;
			setMessages((current) =>
				current.map((message) =>
					message.id === currentAssistantId
						? { ...message, content: message.content + content, status: CHAT_MESSAGE_STATUSES.STREAMING }
						: message,
				),
			);
		}

		const optimistic: ChatMessage[] = [{
			id: tempUserId,
			role: CHAT_ROLES.USER,
			content: retrySourceMessage?.content ?? prompt,
			attachments: retrySourceMessage?.attachments ?? tempAttachments,
			status: CHAT_MESSAGE_STATUSES.DONE,
		}];
		optimistic.push({
			id: tempAssistantId,
			role: CHAT_ROLES.ASSISTANT,
			content: '',
			status: CHAT_MESSAGE_STATUSES.PENDING,
		});
		setMessages((current) => [...current, ...optimistic]);

		const controller = new AbortController();
		requestControllerRef.current = controller;
		try {
			await streamChat({
				conversationId,
				prompt,
				files: currentFiles,
				webSearch,
				retryMessageId,
				signal: controller.signal,
				onEvent: (event) => {
					if (event.type === 'meta') {
						receivedMeta = true;
						currentAssistantId = event.assistantMessageId;
						tempAttachments.forEach((attachment) => {
							URL.revokeObjectURL(attachment.url);
							attachmentUrlsRef.current.delete(attachment.url);
						});
						setMessages((current) =>
							current.map((message) => {
								if (message.id === tempUserId) return event.userMessage;
								if (message.id === tempAssistantId)
									return { ...message, id: event.assistantMessageId, status: CHAT_MESSAGE_STATUSES.STREAMING };
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
						setMessages((current) =>
							current.map((message) =>
								message.id === currentAssistantId ? { ...message, status: CHAT_MESSAGE_STATUSES.DONE } : message,
							),
						);
					} else {
						setMessages((current) =>
							current.map((message) =>
								message.id === currentAssistantId
									? { ...message, content: event.message, status: CHAT_MESSAGE_STATUSES.ERROR }
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
			const messageText = wasStopped
				? 'Генерация остановлена'
				: error instanceof Error
					? error.message
					: 'Неизвестная ошибка';
			if (!receivedMeta) {
				revokeLocalAttachmentUrls();
				setMessages((current) =>
					current.filter((message) => message.id !== tempUserId && message.id !== tempAssistantId),
				);
				setPageError(messageText);
				throw error instanceof Error ? error : new Error(messageText);
			}
			setMessages((current) =>
				current.map((message) =>
					message.id === currentAssistantId || message.id === tempAssistantId
						? {
								...message,
								content: message.content || messageText,
								status: wasStopped ? CHAT_MESSAGE_STATUSES.CANCELLED : CHAT_MESSAGE_STATUSES.ERROR,
							}
						: message,
				),
			);
		} finally {
			if (deltaFrame !== null) cancelAnimationFrame(deltaFrame);
			if (requestControllerRef.current === controller) requestControllerRef.current = null;
			setIsGenerating(false);
			listConversations()
				.then(setConversations)
				.catch((error: unknown) => reportError('Не удалось обновить историю диалогов', error));
		}
	}

	async function handleSendMessage(prompt: string, currentFiles: File[], webSearch: boolean) {
		const conversationId = await ensureConversation();
		await runStream(conversationId, prompt, currentFiles, undefined, webSearch);
	}

	function handleRetry(userMessageId: string) {
		if (activeConversationId) void runStream(activeConversationId, '', [], userMessageId);
	}

	function handleNewConversation() {
		if (isGenerating) requestControllerRef.current?.abort();
		revokeLocalAttachmentUrls();
		setActiveConversationId(null);
		setMessages([]);
		setIsSidebarOpen(false);
	}

	async function handleDeleteConversation(id: string) {
		if (isGenerating && activeConversationId === id) {
			setPageError('Сначала остановите генерацию ответа');
			return;
		}
		if (!window.confirm('Удалить этот диалог и его файлы?')) return;
		await deleteConversation(id);
		const remaining = conversations.filter((item) => item.id !== id);
		setConversations(remaining);
		if (activeConversationId === id) {
			setActiveConversationId(remaining[0]?.id ?? null);
			if (!remaining[0]) {
				revokeLocalAttachmentUrls();
				setMessages([]);
			}
		}
	}

	async function handleRenameConversation(conversation: ConversationSummary) {
		const title = window.prompt('Название диалога', conversation.title)?.trim();
		if (!title || title === conversation.title) return;
		const updated = await renameConversation(conversation.id, title);
		setConversations((current) => current.map((item) => (item.id === updated.id ? updated : item)));
	}

	function handleExport(format: 'markdown' | 'json') {
		if (!hasMessages) return;
		const active = conversations.find((item) => item.id === activeConversationId);
		const safeName = (active?.title ?? 'velorian-dialog').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60);
		if (format === 'json') {
			downloadText(`${safeName}.json`, JSON.stringify({ conversation: active, messages }, null, 2), 'application/json');
			return;
		}
		const markdown = messages
			.map((message) => `## ${message.role === CHAT_ROLES.USER ? 'Вы' : 'Velorian'}\n\n${message.content}\n`)
			.join('\n');
		downloadText(`${safeName}.md`, `# ${active?.title ?? 'Диалог'}\n\n${markdown}`, 'text/markdown');
	}

	function handleAccentChange(theme: AccentTheme) {
		setAccent(theme);
		setAccentTheme(theme);
	}

	function reportActionError(error: unknown, fallback: string) {
		reportError(fallback, error);
		setPageError(error instanceof Error ? error.message : fallback);
	}

	return (
		<div className="chat-shell">
			<ChatSidebar
				user={user}
				conversations={filteredConversations}
				activeConversationId={activeConversationId}
				search={conversationSearch}
				accentTheme={accent}
				isOpen={isSidebarOpen}
				onSearchChange={setConversationSearch}
				onSelect={(id) => {
					requestControllerRef.current?.abort();
					setActiveConversationId(id);
					setIsSidebarOpen(false);
				}}
				onNew={handleNewConversation}
				onDelete={(id) =>
					void handleDeleteConversation(id).catch((error: unknown) =>
						reportActionError(error, 'Не удалось удалить диалог'),
					)
				}
				onRename={(conversation) =>
					void handleRenameConversation(conversation).catch((error: unknown) =>
						reportActionError(error, 'Не удалось переименовать диалог'),
					)
				}
				onAccentChange={handleAccentChange}
				onExport={handleExport}
				onLogout={() => void onLogout()}
				onClose={() => setIsSidebarOpen(false)}
			/>
			<DropZone isDragging={isDragging} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
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
							<MessageList messages={messages} onOpenAttachment={openMessageAttachment} onRetry={handleRetry} />
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
							files={files}
							fileError={fileError}
							isGenerating={isGenerating}
							onSendMessage={handleSendMessage}
							onStop={() => requestControllerRef.current?.abort()}
							onRemoveFile={removeFile}
							onOpenFile={openPromptFile}
							onFilesSelect={addFiles}
							onClearFiles={clearFiles}
						/>
					</div>
				</div>
			</DropZone>
			{isSidebarOpen && (
				<button
					className="chat-shell__backdrop"
					type="button"
					onClick={() => setIsSidebarOpen(false)}
					aria-label="Закрыть меню"
				/>
			)}
			{previewFile && <FilePreviewModal file={previewFile} onClose={closePreview} />}
		</div>
	);
}
