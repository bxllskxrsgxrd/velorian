import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { KNOWLEDGE_RATING_THRESHOLD } from '../../constants/limits';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import './_messageList.scss';

type MessageListProps = {
	messages: ChatMessage[];
	onOpenAttachment: (attachment: ChatAttachment) => void;
	onRetry: (userMessageId: string) => void;
	onEdit: (message: ChatMessage, content: string) => void;
	onActivateBranch: (messageId: string) => void;
	canEdit?: boolean;
	onRate: (message: ChatMessage, score: number, comment?: string) => void;
	onRemoveRating: (message: ChatMessage) => void;
	onSaveToKnowledge: (message: ChatMessage) => void;
};

type BranchInfo = { variants: ChatMessage[]; active: ChatMessage };

function branchGroupId(message: ChatMessage) {
	return message.branchGroupId || message.id;
}

function buildDisplay(messages: ChatMessage[]) {
	const groups = new Map<string, ChatMessage[]>();
	for (const message of messages) {
		if (message.role !== 'user') continue;
		const groupId = branchGroupId(message);
		groups.set(groupId, [...(groups.get(groupId) ?? []), message]);
	}
	const branches = new Map<string, BranchInfo>();
	for (const [groupId, variants] of groups) {
		branches.set(groupId, { variants, active: variants.find((message) => message.isActive !== false) ?? variants.at(-1)! });
	}

	const replyMap = new Map<string, ChatMessage[]>();
	for (const message of messages) {
		if (message.role === 'assistant' && message.replyToId) replyMap.set(message.replyToId, [...(replyMap.get(message.replyToId) ?? []), message]);
	}
	const displayed: ChatMessage[] = [];
	const renderedGroups = new Set<string>();
	for (const message of messages) {
		if (message.role === 'user') {
			const groupId = branchGroupId(message);
			if (renderedGroups.has(groupId)) continue;
			renderedGroups.add(groupId);
			const active = branches.get(groupId)!.active;
			displayed.push(active, ...(replyMap.get(active.id) ?? []));
		} else if (!message.replyToId) {
			displayed.push(message);
		}
	}
	return { displayed, branches };
}

function getRetryMessageIds(messages: ChatMessage[]) {
	const result = new Map<string, string>();
	let previousUserMessageId: string | null = null;
	for (const message of messages) {
		if (message.role === 'user') previousUserMessageId = message.id;
		if (previousUserMessageId) result.set(message.id, previousUserMessageId);
	}
	return result;
}

export function MessageList({ messages, onOpenAttachment, onRetry, onEdit, onActivateBranch, onRate, onRemoveRating, onSaveToKnowledge, canEdit = true }: MessageListProps) {
	const { displayed, branches } = buildDisplay(messages);
	const retryMessageIds = getRetryMessageIds(displayed);
	return (
		<div className="message-list">
			{displayed.map((message) => {
				const retryMessageId = retryMessageIds.get(message.id);
				const branchInfo = message.role === 'user' ? branches.get(branchGroupId(message)) : undefined;
				const branchIndex = branchInfo?.variants.findIndex((variant) => variant.id === message.id) ?? -1;
				return (
					<MessageBubble
						key={message.id}
						onOpenAttachment={onOpenAttachment}
						message={message}
						onRetry={retryMessageId ? () => onRetry(retryMessageId) : undefined}
						onEdit={message.role === 'user' && canEdit ? (content) => onEdit(message, content) : undefined}
						onRate={message.role === 'assistant' && message.status === 'done' ? (score, comment) => onRate(message, score, comment) : undefined}
						onRemoveRating={message.role === 'assistant' && message.status === 'done' ? () => onRemoveRating(message) : undefined}
						onSaveToKnowledge={message.role === 'assistant' && (message.rating?.score ?? 0) >= KNOWLEDGE_RATING_THRESHOLD ? () => onSaveToKnowledge(message) : undefined}
						branch={branchInfo ? {
							index: branchIndex,
							total: branchInfo.variants.length,
							onPrevious: branchIndex > 0 ? () => onActivateBranch(branchInfo.variants[branchIndex - 1].id) : undefined,
							onNext: branchIndex < branchInfo.variants.length - 1 ? () => onActivateBranch(branchInfo.variants[branchIndex + 1].id) : undefined,
						} : undefined}
					/>
				);
			})}
		</div>
	);
}
