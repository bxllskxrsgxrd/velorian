import './_requestMap.scss';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types/chat';

const EMPTY_MESSAGES: ChatMessage[] = [];

export function RequestMap({ conversationId }: { conversationId?: string | null }) {
	const messages = useChatStore((state) => conversationId ? (state.messagesByConversation[conversationId] ?? EMPTY_MESSAGES) : state.messages);
	const requests = messages.filter((message) => message.role === 'user' && message.isActive !== false);
	if (requests.length < 2) return null;

	return (
		<aside className="request-map" aria-label="Карта запросов">
			<span className="request-map__title">Запросы</span>
			<nav>
				{requests.map((message, index) => (
					<button
						type="button"
						key={message.id}
						title={message.content || 'Запрос с файлами'}
						onClick={() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
					>
						<span>{index + 1}</span>
						<span>{message.content || 'Запрос с файлами'}</span>
					</button>
				))}
			</nav>
		</aside>
	);
}
