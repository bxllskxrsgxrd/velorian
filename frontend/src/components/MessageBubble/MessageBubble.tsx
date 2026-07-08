import { CHAT_ROLES } from '../../constants/chatRoles';
import type { ChatMessage } from '../../types/chat';
import './_messageBubble.scss';

type MessageBubbleProps = {
	message: ChatMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
	const isUser = message.role === CHAT_ROLES.USER;

	return (
		<div className={isUser ? 'message message--user' : 'message--assistant'}>
			<div className="message__content">{message.content}</div>
		</div>
	);
}
