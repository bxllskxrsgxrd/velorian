import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import './_messageList.scss';

type MessageListProps = {
	messages: ChatMessage[];
	onOpenAttachment: (attachment: ChatAttachment) => void;
	onRetry: (userMessageId: string) => void;
};

function getRetryMessageIds(messages: ChatMessage[]) {
	const result = new Map<string, string>();
	let previousUserMessageId: string | null = null;
	for (const message of messages) {
		if (message.role === 'user') previousUserMessageId = message.id;
		if (previousUserMessageId) result.set(message.id, previousUserMessageId);
	}
	return result;
}

export function MessageList({ messages, onOpenAttachment, onRetry }: MessageListProps) {
	const retryMessageIds = getRetryMessageIds(messages);
	return (
		<div className="message-list">
			{messages.map((message) => {
				const retryMessageId = retryMessageIds.get(message.id);
				return (
					<MessageBubble
						key={message.id}
						onOpenAttachment={onOpenAttachment}
						message={message}
						onRetry={retryMessageId ? () => onRetry(retryMessageId) : undefined}
					/>
				);
			})}
		</div>
	);
}
