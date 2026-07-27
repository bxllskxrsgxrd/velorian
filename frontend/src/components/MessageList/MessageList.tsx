import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import './_messageList.scss';

type MessageListProps = {
	messages: ChatMessage[];
  onOpenAttachment: (attachment: ChatAttachment) => void;
};

export function MessageList({ messages, onOpenAttachment }: MessageListProps) {
	return <div className='message-list'>
    {messages.map((message) => (
      <MessageBubble key={message.id} onOpenAttachment={onOpenAttachment} message={message} />
    ))}
  </div>;
}
