import './_requestMap.scss';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import type { ChatMessage } from '../../types/chat';

const EMPTY_MESSAGES: ChatMessage[] = [];
const VISIBLE_REQUESTS = 8;

type RequestMapItem = {
	groupId: string;
	message: ChatMessage;
	activeVersion: number;
	versionsCount: number;
};

function buildRequestItems(messages: ChatMessage[]): RequestMapItem[] {
	const groups = new Map<string, ChatMessage[]>();

	for (const message of messages) {
		if (message.role !== 'user') continue;
		const groupId = message.branchGroupId || message.id;
		groups.set(groupId, [...(groups.get(groupId) ?? []), message]);
	}

	return [...groups.entries()].map(([groupId, versions]) => {
		const message = versions.find((version) => version.isActive !== false) ?? versions.at(-1)!;
		return {
			groupId,
			message,
			activeVersion: versions.findIndex((version) => version.id === message.id) + 1,
			versionsCount: versions.length,
		};
	});
}

export function RequestMap({ conversationId }: { conversationId?: string | null }) {
	const messages = useChatStore((state) => conversationId ? (state.messagesByConversation[conversationId] ?? EMPTY_MESSAGES) : state.messages);
	const requests = useMemo(() => buildRequestItems(messages), [messages]);
	const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
	const listRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (requests.length < 2) return;

		const scrollRoot = document.querySelector<HTMLElement>('.chat-page');
		if (!scrollRoot) return;

		let frameId: number | null = null;
		const updateActiveRequest = () => {
			frameId = null;
			const rootRect = scrollRoot.getBoundingClientRect();
			const anchorY = rootRect.top + rootRect.height * 0.42;
			let activeRequest = requests[0];

			for (const request of requests) {
				const element = document.getElementById(`message-${request.message.id}`);
				if (!element) continue;
				if (element.getBoundingClientRect().top <= anchorY) activeRequest = request;
				else break;
			}

			setActiveGroupId(activeRequest.groupId);
		};
		const scheduleUpdate = () => {
			if (frameId === null) frameId = requestAnimationFrame(updateActiveRequest);
		};

		updateActiveRequest();
		scrollRoot.addEventListener('scroll', scheduleUpdate, { passive: true });
		window.addEventListener('resize', scheduleUpdate);

		return () => {
			if (frameId !== null) cancelAnimationFrame(frameId);
			scrollRoot.removeEventListener('scroll', scheduleUpdate);
			window.removeEventListener('resize', scheduleUpdate);
		};
	}, [requests]);

	useEffect(() => {
		const list = listRef.current;
		if (!list || !activeGroupId || requests.length <= VISIBLE_REQUESTS) return;
		const activeItem = [...list.querySelectorAll<HTMLElement>('.request-map__item')]
			.find((item) => item.dataset.groupId === activeGroupId);
		if (!activeItem) return;

		if (activeItem.offsetTop < list.scrollTop) list.scrollTop = activeItem.offsetTop;
		else if (activeItem.offsetTop + activeItem.offsetHeight > list.scrollTop + list.clientHeight)
			list.scrollTop = activeItem.offsetTop + activeItem.offsetHeight - list.clientHeight;
	}, [activeGroupId, requests.length]);

	if (requests.length < 2) return null;

	function scrollToRequest(request: RequestMapItem) {
		setActiveGroupId(request.groupId);
		document.getElementById(`message-${request.message.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	return (
		<aside
			className={`request-map${requests.length > VISIBLE_REQUESTS ? ' request-map--scrollable' : ''}`}
			aria-label="Карта запросов"
		>
			<nav className="request-map__list" ref={listRef}>
				{requests.map((request) => {
					const isActive = request.groupId === activeGroupId;
					const label = request.message.content || 'Запрос с файлами';
					const accessibleLabel = request.versionsCount > 1
						? `${request.activeVersion}/${request.versionsCount} ${label}`
						: label;
					return (
						<button
							className={`request-map__item${isActive ? ' request-map__item--active' : ''}`}
							type="button"
							key={request.groupId}
							data-group-id={request.groupId}
							title={label}
							aria-label={accessibleLabel}
							aria-current={isActive ? 'location' : undefined}
							onClick={() => scrollToRequest(request)}
						>
							<span className="request-map__content">
								{request.versionsCount > 1 && (
									<span className="request-map__version">
										{request.activeVersion}/{request.versionsCount}
									</span>
								)}
								<span className="request-map__text">{label}</span>
							</span>
							<span className="request-map__marker" aria-hidden="true" />
						</button>
					);
				})}
			</nav>
		</aside>
	);
}
