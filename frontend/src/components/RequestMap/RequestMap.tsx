import type { ChatMessage } from '../../types/chat';
import './_requestMap.scss';

type RequestMapProps = { messages: ChatMessage[] };

export function RequestMap({ messages }: RequestMapProps) {
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
