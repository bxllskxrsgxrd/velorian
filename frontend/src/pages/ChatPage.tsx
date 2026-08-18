import { useEffect, useRef, useState } from 'react';
import { sendChatMessage } from '../api/chatApi';
import { FilePreviewModal } from '../components/FilePreviewModal/FilePreviewModal';
import { MessageList } from '../components/MessageList/MessageList';
import { PromptBar } from '../components/PromptBar/PromptBar';
import { DropZone } from '../components/ui/DropZone/DropZone';
import { CHAT_MESSAGE_STATUSES } from '../constants/chatMessageStatuses';
import { CHAT_ROLES } from '../constants/chatRoles';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import type { ChatAttachment, ChatMessage, PreviewFile } from '../types/chat';
import { attachmentToPreviewFile, createChatAttachment, fileToPreviewFile } from '../utils/files';
import './_chatPage.scss';

export function ChatPage() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<string | null>(null);
	const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
	const chatPageRef = useRef<HTMLDivElement | null>(null);
	const attachmentUrlsRef = useRef(new Set<string>());
	const previewFileRef = useRef<PreviewFile | null>(null);
	const requestControllerRef = useRef<AbortController | null>(null);

	const { isDragging, files, addFiles, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles } =
		useDragAndDrop();

	const hasMessages = messages.length > 0;

	useEffect(() => {
		if (!hasMessages) return;

		const frameId = requestAnimationFrame(() => {
			chatPageRef.current?.scrollTo({
				top: chatPageRef.current.scrollHeight,
				behavior: 'smooth',
			});
		});

		return () => cancelAnimationFrame(frameId);
	}, [messages.length, hasMessages]);

	useEffect(() => {
		const attachmentUrls = attachmentUrlsRef.current;

		return () => {
			requestControllerRef.current?.abort();
			attachmentUrls.forEach((url) => URL.revokeObjectURL(url));

			if (previewFileRef.current?.revokeOnClose) {
				URL.revokeObjectURL(previewFileRef.current.url);
			}
		};
	}, []);

	function revokePreviewFile(file: PreviewFile | null) {
		if (file?.revokeOnClose) {
			URL.revokeObjectURL(file.url);
		}
	}

	function openPromptFile(file: File) {
		revokePreviewFile(previewFile);
		const nextPreviewFile = fileToPreviewFile(file);

		previewFileRef.current = nextPreviewFile;
		setPreviewFile(nextPreviewFile);
	}

	function openMessageAttachment(attachment: ChatAttachment) {
		revokePreviewFile(previewFile);

		const nextPreviewFile = attachmentToPreviewFile(attachment);

		previewFileRef.current = nextPreviewFile;
		setPreviewFile(nextPreviewFile);
	}

	function closePreview() {
		revokePreviewFile(previewFile);

		previewFileRef.current = null;
		setPreviewFile(null);
	}

	async function handleSendMessage(prompt: string, currentFiles: File[]) {
		if (!prompt.trim() && currentFiles.length === 0) return;

		const userMessageId = crypto.randomUUID();

		const attachments = currentFiles.map(createChatAttachment);

		attachments.forEach((attachment) => attachmentUrlsRef.current.add(attachment.url));

		const userMessage: ChatMessage = {
			id: userMessageId,
			role: CHAT_ROLES.USER,
			content: prompt,
			attachments,
		};

		const assistantMessageId = crypto.randomUUID();

		const assistantMessage: ChatMessage = {
			id: assistantMessageId,
			role: CHAT_ROLES.ASSISTANT,
			content: '',
			status: CHAT_MESSAGE_STATUSES.PENDING,
		};

		setActiveAssistantMessageId(assistantMessageId);

		setMessages((prevMessages) => [...prevMessages, userMessage, assistantMessage]);

		const requestController = new AbortController();
		requestControllerRef.current = requestController;
		const timeoutId = window.setTimeout(() => requestController.abort(), 120_000);

		try {
			const conversation = [...messages, userMessage].filter(
				(message) => message.status !== CHAT_MESSAGE_STATUSES.ERROR,
			);
			const dataResponse = await sendChatMessage(conversation, currentFiles, requestController.signal);

			setMessages((prevMessages) =>
				prevMessages.map((message) =>
					message.id === assistantMessageId
						? { ...message, content: dataResponse.response, status: CHAT_MESSAGE_STATUSES.DONE }
						: message,
				),
			);
		} catch (error) {
			const isAbortError = error instanceof DOMException && error.name === 'AbortError';
			const errorText = isAbortError
				? 'Время ожидания ответа истекло'
				: error instanceof Error
					? error.message
					: 'Неизвестная ошибка';

			console.error(`Ошибка запроса: ${errorText}`);

			setMessages((prevMessages) =>
				prevMessages.map((message) =>
					message.id === assistantMessageId
						? { ...message, content: errorText, status: CHAT_MESSAGE_STATUSES.ERROR }
						: message,
				),
			);
		} finally {
			window.clearTimeout(timeoutId);

			if (requestControllerRef.current === requestController) {
				requestControllerRef.current = null;
			}
		}
	}
	return (
		<>
			<DropZone isDragging={isDragging} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
				<div ref={chatPageRef} className={hasMessages ? 'chat-page chat-page--chat' : 'chat-page chat-page--start'}>
					<main className="chat-page__body">
						{hasMessages ? (
							<MessageList
								messages={messages}
								onOpenAttachment={openMessageAttachment}
								activeAssistantMessageId={activeAssistantMessageId}
							/>
						) : (
							<div className="chat-page-start">
								<h1 className="chat-page__heading">Введи запрос</h1>
							</div>
						)}
					</main>

					<div className="chat-page__prompt">
						<PromptBar
							files={files}
							onSendMessage={handleSendMessage}
							onRemoveFile={removeFile}
							onOpenFile={openPromptFile}
							onFilesSelect={addFiles}
							onClearFiles={clearFiles}
						/>
					</div>
				</div>
			</DropZone>
			{previewFile && <FilePreviewModal file={previewFile} onClose={closePreview} />}
		</>
	);
}
