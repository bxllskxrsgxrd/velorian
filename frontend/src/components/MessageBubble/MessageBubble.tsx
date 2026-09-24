import { lazy, memo, Suspense } from 'react';
import { CHAT_MESSAGE_STATUSES } from '../../constants/chatMessageStatuses';
import { CHAT_ROLES } from '../../constants/chatRoles';
import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { SubmitLoadingIcon } from '../icons/SubmitLoadingIcon/SubmitLoadingIcon';
import { CheckIcon, DocumentCheckIcon, DocumentIcon, EditIcon, TextIcon, UndoIcon } from '../icons/AppIcons';
import { CustomSelect } from '../ui/CustomSelect/CustomSelect';
import './_messageBubble.scss';
import { MessageAttachment } from './MessageAttachment';
import { MessageError } from './MessageError';
import { MessageRating } from './MessageRating';
import { UserMessageContent } from './UserMessageContent';
import { getUserFacingError } from '../../errors/userErrorMessages';
import { useMessageUiStore } from '../../stores/messageUiStore';
import { Button } from '../ui/Button/Button';

const AssistantMessageContent = lazy(() => import('./AssistantMessageContent'));

type MessageBubbleProps = {
	message: ChatMessage;
	onOpenAttachment: (attachment: ChatAttachment) => void;
	onRetry?: () => void;
	onEdit?: (content: string) => void;
	branch?: { index: number; total: number; onPrevious?: () => void; onNext?: () => void };
	onRate?: (score: number, comment?: string) => void;
	onRemoveRating?: () => void;
	onCreateFile?: () => Promise<void>;
	onAddToKnowledge?: (attachment?: ChatAttachment) => void;
	onOpenKnowledge?: () => void;
};

function MessageBubbleComponent({
	message,
	onOpenAttachment,
	onRetry,
	onEdit,
	branch,
	onRate,
	onRemoveRating,
	onCreateFile,
	onAddToKnowledge,
	onOpenKnowledge,
}: MessageBubbleProps) {
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
		? (message.error ??
			getUserFacingError(
				message.errorCode ?? (isHistoricalCancelledError ? 'AI_REQUEST_INTERRUPTED' : 'HISTORICAL_MESSAGE_ERROR'),
				0,
				message.requestId,
			))
		: undefined;

	const attachments = message.attachments ?? [];

	const imageAttachments = attachments.filter((attachment) => attachment.type.startsWith('image/'));

	const fileAttachments = attachments.filter((attachment) => !attachment.type.startsWith('image/'));
	const generatedFileAttachments = isUser ? [] : fileAttachments.filter((attachment) => attachment.generated);
	const generatedFile = generatedFileAttachments[0];
	const leadingFileAttachments = isUser
		? fileAttachments
		: fileAttachments.filter((attachment) => !attachment.generated);

	const hasAttachments = attachments.length > 0;
	const hasImages = imageAttachments.length > 0;
	const hasText = Boolean(message.content);
	const isFileCreated = fileState === 'success' || Boolean(generatedFile);
	const showCompletedAssistantActions = !isUser && !isPending && !isStreaming && !isCancelled;
	const hasKnowledgeItem = Boolean(message.knowledgeItem);

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

			{leadingFileAttachments.length > 0 && (
				<div className="message__files">
					{leadingFileAttachments.map((attachment) => (
						<MessageAttachment
							key={attachment.id}
							attachment={attachment}
							onOpen={() => onOpenAttachment(attachment)}
						/>
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
					<div>
						<Button
							variant="filled"
							tone="neutral"
							size="medium"
							onClick={() => cancelEditing(message.id, message.content)}
						>
							Отмена
						</Button>
						<Button
							variant="filled"
							tone="accent"
							size="medium"
							disabled={!draft.trim() || draft.trim() === message.content.trim()}
							onClick={() => {
								onEdit?.(draft.trim());
								finishEditing(message.id);
							}}
						>
							Отправить
						</Button>
					</div>
				</div>
			) : (
				hasText && (
					<div className={contentClassName}>
						{isUser ? (
							<UserMessageContent content={message.content} />
						) : (
							<Suspense fallback={<span className="message__markdown-loading">Форматирование ответа…</span>}>
								<AssistantMessageContent content={message.content} isStreaming={isStreaming} />
							</Suspense>
						)}
					</div>
				)
			)}
			{showCompletedAssistantActions &&
				((onRate && onRemoveRating) || (onCreateFile && hasText) || onAddToKnowledge || message.knowledgeItem) && (
					<div className="message__assistant-actions">
						{onRate && onRemoveRating && (
							<MessageRating
								compact
								readonly={hasKnowledgeItem}
								messageId={message.id}
								rating={message.rating}
								onRate={onRate}
								onRemove={onRemoveRating}
							/>
						)}
						{onRate && onRemoveRating && onCreateFile && hasText && (
							<span className="message__assistant-actions-divider" aria-hidden="true" />
						)}
						{onCreateFile &&
							hasText &&
							(isFileCreated ? (
								<span className="message__file-created" role="status">
									<DocumentCheckIcon />
									Файл создан
								</span>
							) : (
								<Button
									variant="outline"
									tone="neutral"
									size="small"
									icon={<DocumentIcon />}
									className="message__create-file"
									disabled={fileState === 'loading'}
									onClick={() => {
										setFileState(message.id, 'loading');
										void onCreateFile()
											.then(() => setFileState(message.id, 'success'))
											.catch(() => setFileState(message.id, 'error'));
									}}
								>
									{fileState === 'loading' ? 'Создание…' : 'Создать файл'}
								</Button>
							))}
						{fileState === 'error' && (
							<span className="message__create-file-error" role="status">
								Не удалось создать файл
							</span>
						)}
						{(onAddToKnowledge || message.knowledgeItem) && (
							<span className="message__assistant-actions-divider" aria-hidden="true" />
						)}
						{message.knowledgeItem ? (
							<Button
								variant="outline"
								tone="neutral"
								size="small"
								className={`message__knowledge-action${message.knowledgeItem.deletedAt ? ' message__knowledge-action--trash' : ' message__knowledge-action--saved'}`}
								onClick={onOpenKnowledge}
							>
								{message.knowledgeItem.deletedAt ? (
									<>
										<UndoIcon size={10} /> <span>В корзине</span>
									</>
								) : (
									<>
										<CheckIcon size={10} /> <span>В базе знаний</span>
									</>
								)}
							</Button>
						) : // <button
						// 	className={`message__knowledge-action${message.knowledgeItem.deletedAt ? ' message__knowledge-action--trash' : ' message__knowledge-action--saved'}`}
						// 	type="button"
						// 	onClick={onOpenKnowledge}
						// >
						// 	{message.knowledgeItem.deletedAt ? (
						// 		<>
						// 			<UndoIcon size={10} /> <span>В корзине</span>
						// 		</>
						// 	) : (
						// 		<>
						// 			<CheckIcon size={10} /> <span>В базе знаний</span>
						// 		</>
						// 	)}
						// </button>
						generatedFile && onAddToKnowledge ? (
							<CustomSelect
								className="message__knowledge-select"
								value=""
								ariaLabel="Добавить в базу"
								triggerLabel="Добавить в базу"
								placement="bottom"
								disabled={fileState === 'loading'}
								onChange={(value) => onAddToKnowledge(value === 'file' ? generatedFile : undefined)}
								options={[
									{
										value: 'text',
										label: (
											<span className="message__knowledge-option">
												<TextIcon size={16} />
												<span>
													<strong>Текст ответа</strong>
													<small>Добавить содержимое сообщения</small>
												</span>
											</span>
										),
									},
									{
										value: 'file',
										label: (
											<span className="message__knowledge-option">
												<DocumentIcon size={16} />
												<span>
													<strong>{`Файл «${generatedFile.name}»`}</strong>
													<small>Добавить созданный файл</small>
												</span>
											</span>
										),
									},
								]}
							/>
						) : onAddToKnowledge ? (
							<Button
								variant="outline"
								tone="neutral"
								size="small"
								className="message__knowledge-action"
								disabled={fileState === 'loading'}
								onClick={() => onAddToKnowledge()}
							>
								Добавить текст в базу
							</Button>
						) : null}
					</div>
				)}
			{generatedFileAttachments.length > 0 && (
				<div className="message__files message__files--generated">
					{generatedFileAttachments.map((attachment) => (
						<MessageAttachment
							key={attachment.id}
							attachment={attachment}
							onOpen={() => onOpenAttachment(attachment)}
							showKnowledgeAction={false}
						/>
					))}
				</div>
			)}
			{isUser && !isEditing && (onEdit || (branch && branch.total > 1)) && (
				<div className="message__user-actions">
					{branch && branch.total > 1 && (
						<div className="message__branches">
							<button
								type="button"
								onClick={branch.onPrevious}
								disabled={!branch.onPrevious}
								aria-label="Предыдущая версия"
							>
								‹
							</button>
							<span>
								{branch.index + 1} / {branch.total}
							</span>
							<button type="button" onClick={branch.onNext} disabled={!branch.onNext} aria-label="Следующая версия">
								›
							</button>
						</div>
					)}
					{onEdit && (
						<button
							type="button"
							onClick={() => startEditing(message.id, message.content)}
							aria-label="Редактировать сообщение"
						>
							<EditIcon size={15} />
						</button>
					)}
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

export const MessageBubble = memo(
	MessageBubbleComponent,
	(previous, next) =>
		previous.message === next.message &&
		previous.branch?.index === next.branch?.index &&
		previous.branch?.total === next.branch?.total &&
		Boolean(previous.branch?.onPrevious) === Boolean(next.branch?.onPrevious) &&
		Boolean(previous.branch?.onNext) === Boolean(next.branch?.onNext) &&
		Boolean(previous.onRetry) === Boolean(next.onRetry) &&
		Boolean(previous.onEdit) === Boolean(next.onEdit) &&
		Boolean(previous.onRate) === Boolean(next.onRate) &&
		Boolean(previous.onRemoveRating) === Boolean(next.onRemoveRating) &&
		Boolean(previous.onCreateFile) === Boolean(next.onCreateFile) &&
		Boolean(previous.onAddToKnowledge) === Boolean(next.onAddToKnowledge) &&
		Boolean(previous.onOpenKnowledge) === Boolean(next.onOpenKnowledge),
);
