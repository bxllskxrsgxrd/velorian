import { lazy, memo, Suspense } from 'react';
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
import { getUserFacingError } from '../../errors/userErrorMessages';
import { useMessageUiStore } from '../../stores/messageUiStore';

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
	onCreateFile?: () => Promise<void>;
	onAddAttachmentToKnowledge?: (attachment: ChatAttachment) => void;
};

function MessageBubbleComponent({ message, onOpenAttachment, onRetry, onEdit, branch, onRate, onRemoveRating, onSaveToKnowledge, onCreateFile, onAddAttachmentToKnowledge }: MessageBubbleProps) {
	const isEditing = useMessageUiStore((state) => state.byMessageId[message.id]?.isEditing ?? false);
	const draft = useMessageUiStore((state) => state.byMessageId[message.id]?.draft ?? message.content);
	const fileState = useMessageUiStore((state) => state.byMessageId[message.id]?.fileState ?? 'idle');
	const startEditing = useMessageUiStore((state) => state.startEditing);
	const cancelEditing = useMessageUiStore((state) => state.cancelEditing);
	const finishEditing = useMessageUiStore((state) => state.finishEditing);
	const setDraft = useMessageUiStore((state) => state.setDraft);
	const setFileState = useMessageUiStore((state) => state.setFileState);
	const isUser = message.role === CHAT_ROLES.USER;

	const isPending = !isUser && message.status === CHAT_MESSAGE_STATUSES.PENDING && !message.content;
	const isStreaming = !isUser && message.status === CHAT_MESSAGE_STATUSES.STREAMING;
	const isError = !isUser && message.status === CHAT_MESSAGE_STATUSES.ERROR;
	const isCancelled = !isUser && message.status === CHAT_MESSAGE_STATUSES.CANCELLED;
	const isHistoricalCancelledError = isCancelled && !message.content.trim();
	const shouldRenderError = isError || isHistoricalCancelledError;
	const error = shouldRenderError
		? message.error ?? getUserFacingError(
			message.errorCode ?? (isHistoricalCancelledError ? 'AI_REQUEST_INTERRUPTED' : 'HISTORICAL_MESSAGE_ERROR'),
			0,
			message.requestId,
		)
		: undefined;

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
		shouldRenderError && 'message--error',
	]
		.filter(Boolean)
		.join(' ');

	if (shouldRenderError) {
		return (
			<div className={messageClassName} id={`message-${message.id}`} role="alert" aria-live="assertive">
				<MessageError error={error!} onRetry={onRetry} />
			</div>
		);
	}

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
						<MessageAttachment key={attachment.id} attachment={attachment} onOpen={() => onOpenAttachment(attachment)} onAddToKnowledge={attachment.generated && onAddAttachmentToKnowledge ? () => onAddAttachmentToKnowledge(attachment) : undefined} />
					))}
				</div>
			)}

			{isPending && (
				<div className="message__content message__content--pending">
					<SubmitLoadingIcon />
				</div>
			)}

			{isUser && isEditing ? (
				<div className="message__editor">
					<textarea autoFocus value={draft} onChange={(event) => setDraft(message.id, event.target.value)} />
					<div><button type="button" onClick={() => cancelEditing(message.id, message.content)}>Отмена</button><button type="button" disabled={!draft.trim() || draft.trim() === message.content.trim()} onClick={() => { onEdit?.(draft.trim()); finishEditing(message.id); }}>Отправить</button></div>
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
			{!isUser && !isPending && !isStreaming && !isCancelled && onRate && onRemoveRating && (
				<MessageRating messageId={message.id} rating={message.rating} onRate={onRate} onRemove={onRemoveRating} onSaveToKnowledge={onSaveToKnowledge} />
			)}
			{!isUser && !isPending && !isStreaming && !isCancelled && onCreateFile && hasText && (
				<div className="message__actions message__actions--file">
					<button type="button" disabled={fileState === 'loading' || fileState === 'success'} onClick={() => {
						setFileState(message.id, 'loading');
						void onCreateFile().then(() => setFileState(message.id, 'success')).catch(() => setFileState(message.id, 'error'));
					}}>{fileState === 'loading' ? 'Создание…' : fileState === 'success' ? 'Файл создан' : 'Создать файл'}</button>
					{fileState === 'error' && <span role="status">Не удалось создать файл</span>}
				</div>
			)}
			{isUser && !isEditing && (onEdit || (branch && branch.total > 1)) && (
				<div className="message__user-actions">
					{branch && branch.total > 1 && <div className="message__branches"><button type="button" onClick={branch.onPrevious} disabled={!branch.onPrevious} aria-label="Предыдущая версия">‹</button><span>{branch.index + 1} / {branch.total}</span><button type="button" onClick={branch.onNext} disabled={!branch.onNext} aria-label="Следующая версия">›</button></div>}
					{onEdit && <button type="button" onClick={() => startEditing(message.id, message.content)} aria-label="Редактировать сообщение"><EditIcon size={15} /></button>}
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

export const MessageBubble = memo(MessageBubbleComponent, (previous, next) =>
	previous.message === next.message &&
	previous.branch?.index === next.branch?.index &&
	previous.branch?.total === next.branch?.total &&
	Boolean(previous.branch?.onPrevious) === Boolean(next.branch?.onPrevious) &&
	Boolean(previous.branch?.onNext) === Boolean(next.branch?.onNext) &&
	Boolean(previous.onRetry) === Boolean(next.onRetry) &&
	Boolean(previous.onEdit) === Boolean(next.onEdit) &&
	Boolean(previous.onRate) === Boolean(next.onRate) &&
	Boolean(previous.onRemoveRating) === Boolean(next.onRemoveRating) &&
	Boolean(previous.onSaveToKnowledge) === Boolean(next.onSaveToKnowledge) &&
	Boolean(previous.onCreateFile) === Boolean(next.onCreateFile) &&
	Boolean(previous.onAddAttachmentToKnowledge) === Boolean(next.onAddAttachmentToKnowledge),
);
