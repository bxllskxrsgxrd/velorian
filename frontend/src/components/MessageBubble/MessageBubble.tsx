import { CHAT_ROLES } from '../../constants/chatRoles';
import type { ChatMessage } from '../../types/chat';
import './_messageBubble.scss';
import { MessageAttachment } from './MessageAttachment';

type MessageBubbleProps = {
	message: ChatMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
	const isUser = message.role === CHAT_ROLES.USER;
	const hasAttachments = Boolean(message.attachments?.length);
	const hasText = Boolean(message.content);

	const imageAttachments = message.attachments?.filter((attachment) => attachment.type.startsWith('image/'));

	const fileAttachments = message.attachments?.filter((attachment) => !attachment.type.startsWith('image/'));

	const hasImages = Boolean(imageAttachments?.length);
	const hasFiles = Boolean(fileAttachments?.length);

	return (
		<div className={isUser ? 'message message--user' : 'message message--assistant'}>
			{hasImages && (
				<div className="message__media">
					{imageAttachments?.map((attachment) => (
						<div className="message__attachment" key={attachment.id}>
							<MessageAttachment attachment={attachment} />
						</div>
					))}
				</div>
			)}

			{hasFiles && (
				<div className="message__files">
					{fileAttachments?.map((attachment) => (
						<div className="message__attachment" key={attachment.id}>
							<MessageAttachment attachment={attachment} />
						</div>
					))}
				</div>
			)}

			{hasText && (
				<div className={hasAttachments ? 'message__content message__content--with-attachments' : 'message__content'}>
					{message.content}
				</div>
			)}
		</div>
	);
}
