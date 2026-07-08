import type { ChatMessage } from '../../types/chat';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import './_messageList.scss';

type MessageListProps = {
	messages: ChatMessage[];
};

export function MessageList({ messages }: MessageListProps) {
	return <div className='message-list'>
    {messages.map((message) => (
      <MessageBubble message={message} />
    ))}
  </div>;
}
