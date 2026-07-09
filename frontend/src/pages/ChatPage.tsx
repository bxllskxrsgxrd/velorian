import React, { useEffect, useRef, useState } from 'react';
import { PromptBar } from '../components/PromptBar/PromptBar';
import { DropZone } from '../components/ui/DragAndDrop/DropZone';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import '../scss/default/_index.scss';
import './_chatPage.scss';
import type { ChatAttachment, ChatMessage, PreviewFile } from '../types/chat';
import { CHAT_ROLES } from '../constants/chatRoles';
import { sendChatMessage } from '../api/chatApi';
import { MessageList } from '../components/MessageList/MessageList';
import { createChatAttachment } from '../utils/files';

export function ChatPage() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
	const chatPageRef = useRef<HTMLDivElement | null>(null);

	const { isDragging, files, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles } = useDragAndDrop();

	const hasMessages = messages.length > 0;

	useEffect(() => {
		if (!hasMessages) return;

		requestAnimationFrame(() => {
			chatPageRef.current?.scrollTo({
				top: chatPageRef.current.scrollHeight,
				behavior: 'smooth',
			});
		});
	}, [messages.length, hasMessages]);

	function revokePreviewFile(file: PreviewFile | null) {
		if (file?.revokeOnClose) {
			URL.revokeObjectURL(file.url);
		}
	}

	async function handleSendMessage(prompt: string) {
		const currentFiles = [...files];

		if (!prompt.trim() && currentFiles.length === 0) return;

		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: CHAT_ROLES.USER,
			content: prompt,
			attachments: currentFiles.map(createChatAttachment),
		};

		setMessages((prevMessage) => [...prevMessage, userMessage]);

		try {
			const dataResponse = await sendChatMessage(prompt, currentFiles);

			const assistantMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: CHAT_ROLES.ASSISTANT,
				content: dataResponse.response,
			};

			setMessages((prevMessage) => [...prevMessage, assistantMessage]);

			console.log(`User: ${prompt}\n\nGrok: ${dataResponse.response}`);

			clearFiles();
		} catch (error) {
			console.error(`Ошибка запроса: ${error}`);

			const errorMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: CHAT_ROLES.ASSISTANT,
				content: 'Ошибка при получении ответа',
			};

			setMessages((prevMessage) => [...prevMessage, errorMessage]);
		}
	}
	return (
		<DropZone isDragging={isDragging} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
			<div ref={chatPageRef} className={hasMessages ? 'chat-page chat-page--chat' : 'chat-page chat-page--start'}>
				<main className="chat-page__body">
					{hasMessages ? (
						<MessageList messages={messages} />
					) : (
						<div className="chat-page-start">
							<h1 className="chat-page__heading">Введи запрос</h1>
						</div>
					)}
				</main>

				<div className="chat-page__prompt">
					<PromptBar files={files} onSendMessage={handleSendMessage} onRemoveFile={removeFile} />
				</div>
			</div>
		</DropZone>
	);
}
