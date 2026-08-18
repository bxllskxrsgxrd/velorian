import { CHAT_MESSAGE_STATUSES } from '../../constants/chatMessageStatuses';
import { CHAT_ROLES } from '../../constants/chatRoles';
import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { SubmitLoadingIcon } from '../icons/SubmitLoadingIcon/SubmitLoadingIcon';
import './_messageBubble.scss';
import { AssistantMessageContent } from './AssistantMessageContent';
import { MessageAttachment } from './MessageAttachment';
import { UserMessageContent } from './UserMessageContent';

type MessageBubbleProps = {
	message: ChatMessage;
	onOpenAttachment: (attachment: ChatAttachment) => void;
	shouldAnimate?: boolean;
};

export function MessageBubble({ message, onOpenAttachment, shouldAnimate = false }: MessageBubbleProps) {
	const isUser = message.role === CHAT_ROLES.USER;

	const isPending = !isUser && message.status === CHAT_MESSAGE_STATUSES.PENDING;
	const isError = !isUser && message.status === CHAT_MESSAGE_STATUSES.ERROR;

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
		isError && 'message--error',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div className={messageClassName}>
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

			{isPending && (
				<div className="message__content message__content--pending">
					<SubmitLoadingIcon />
				</div>
			)}

			{hasText && (
				<div className={contentClassName}>
					{isUser ? (
						<UserMessageContent content={message.content} />
					) : (
						<AssistantMessageContent messageId={message.id} content={message.content} shouldAnimate={shouldAnimate} />
					)}
				</div>
			)}
		</div>
	);
}
