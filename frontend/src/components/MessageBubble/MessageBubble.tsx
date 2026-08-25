import { lazy, Suspense, useState } from 'react';
import { CHAT_MESSAGE_STATUSES } from '../../constants/chatMessageStatuses';
import { CHAT_ROLES } from '../../constants/chatRoles';
import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { SubmitLoadingIcon } from '../icons/SubmitLoadingIcon/SubmitLoadingIcon';
import { EditIcon } from '../icons/AppIcons';
import './_messageBubble.scss';
import { MessageAttachment } from './MessageAttachment';
import { MessageError } from './MessageError';
import { MessageRating } from './MessageRating';
import { UserMessageContent } from './UserMessageContent';

const AssistantMessageContent = lazy(() => import('./AssistantMessageContent'));

type MessageBubbleProps = {
	message: ChatMessage;
	onOpenAttachment: (attachment: ChatAttachment) => void;
	onRetry?: () => void;
	onEdit?: (content: string) => void;
	branch?: { index: number; total: number; onPrevious?: () => void; onNext?: () => void };
	onRate?: (score: number, comment?: string) => void;
	onRemoveRating?: () => void;
	onSaveToKnowledge?: () => void;
};

export function MessageBubble({ message, onOpenAttachment, onRetry, onEdit, branch, onRate, onRemoveRating, onSaveToKnowledge }: MessageBubbleProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(message.content);
	const isUser = message.role === CHAT_ROLES.USER;

	const isPending = !isUser && message.status === CHAT_MESSAGE_STATUSES.PENDING && !message.content;
	const isStreaming = !isUser && message.status === CHAT_MESSAGE_STATUSES.STREAMING;
	const isError = !isUser && message.status === CHAT_MESSAGE_STATUSES.ERROR;
	const isCancelled = !isUser && message.status === CHAT_MESSAGE_STATUSES.CANCELLED;

	const attachments = message.attachments ?? [];

	const imageAttachments = attachments.filter((attachment) => attachment.type.startsWith('image/'));

	const fileAttachments = attachments.filter((attachment) => !attachment.type.startsWith('image/'));

	const hasAttachments = attachments.length > 0;
	const hasImages = imageAttachments.length > 0;
	const hasFiles = fileAttachments.length > 0;
	const hasText = Boolean(message.content);

	const contentClassName = ['message__content', hasAttachments && 'message__content--with-attachments']
		.filter(Boolean)
		.join(' ');
	const messageClassName = [
		'message',
		isUser ? 'message--user' : 'message--assistant',
		(isError || isCancelled) && 'message--error',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div className={messageClassName} id={`message-${message.id}`}>
			{hasImages && (
				<div className="message__media">
					{imageAttachments?.map((attachment) => (
						<button
							className="message__attachment-button"
							key={attachment.id}
							type="button"
							onClick={() => onOpenAttachment(attachment)}
						>
							<MessageAttachment attachment={attachment} />
						</button>
					))}
				</div>
			)}

			{hasFiles && (
				<div className="message__files">
					{fileAttachments?.map((attachment) => (
						<MessageAttachment key={attachment.id} attachment={attachment} onOpen={() => onOpenAttachment(attachment)} />
					))}
				</div>
			)}

			{isPending && (
				<div className="message__content message__content--pending">
					<SubmitLoadingIcon />
				</div>
			)}

			{isError ? (
				<MessageError message={message.content} requestId={message.requestId} onRetry={onRetry} />
			) : isUser && isEditing ? (
				<div className="message__editor">
					<textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
					<div><button type="button" onClick={() => { setDraft(message.content); setIsEditing(false); }}>Отмена</button><button type="button" disabled={!draft.trim() || draft.trim() === message.content.trim()} onClick={() => { onEdit?.(draft.trim()); setIsEditing(false); }}>Отправить</button></div>
				</div>
			) : hasText && (
				<div className={contentClassName}>
					{isUser ? (
						<UserMessageContent content={message.content} />
					) : (
						<Suspense fallback={<span className="message__markdown-loading">Форматирование ответа…</span>}><AssistantMessageContent content={message.content} isStreaming={isStreaming} /></Suspense>
					)}
				</div>
			)}
			{!isUser && !isPending && !isStreaming && !isError && !isCancelled && onRate && onRemoveRating && (
				<MessageRating rating={message.rating} onRate={onRate} onRemove={onRemoveRating} onSaveToKnowledge={onSaveToKnowledge} />
			)}
			{isUser && !isEditing && (onEdit || (branch && branch.total > 1)) && (
				<div className="message__user-actions">
					{branch && branch.total > 1 && <div className="message__branches"><button type="button" onClick={branch.onPrevious} disabled={!branch.onPrevious} aria-label="Предыдущая версия">‹</button><span>{branch.index + 1} / {branch.total}</span><button type="button" onClick={branch.onNext} disabled={!branch.onNext} aria-label="Следующая версия">›</button></div>}
					{onEdit && <button type="button" onClick={() => { setDraft(message.content); setIsEditing(true); }} aria-label="Редактировать сообщение"><EditIcon size={15} /></button>}
				</div>
			)}
			{!isUser && !isPending && !isStreaming && isCancelled && onRetry && (
				<div className="message__actions">
					<button type="button" onClick={onRetry}>
						Повторить
					</button>
				</div>
			)}
		</div>
	);
}
