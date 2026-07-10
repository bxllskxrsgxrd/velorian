import { CHAT_ROLES } from '../../constants/chatRoles';
import type { ChatAttachment, ChatMessage } from '../../types/chat';
import './_messageBubble.scss';
import { MessageAttachment } from './MessageAttachment';

type MessageBubbleProps = {
	message: ChatMessage;
	onOpenAttachment: (attachment: ChatAttachment) => void;
};

export function MessageBubble({ message, onOpenAttachment }: MessageBubbleProps) {
	const isUser = message.role === CHAT_ROLES.USER;
	const hasAttachments = Boolean(message.attachments?.length);
	const hasText = Boolean(message.content);

	const imageAttachments = message.attachments?.filter((attachment) => attachment.type.startsWith('image/'));

	const fileAttachments = message.attachments?.filter((attachment) => !attachment.type.startsWith('image/'));

	const hasImages = Boolean(imageAttachments?.length);
	const hasFiles = Boolean(fileAttachments?.length);

	const contentClassName = hasAttachments ? 'message__content message__content--with-attachments' : 'message__content';

	return (
		<div className={isUser ? 'message message--user' : 'message message--assistant'}>
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

			{hasText && <div className={contentClassName}>{message.content}</div>}
		</div>
	);
}
