import type { ChatAttachment, ChatMessage } from '../../types/chat';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import './_messageList.scss';
import { useChatStore } from '../../stores/chatStore';
import { chatBranchGroupId, getActiveBranchMessages } from '../../utils/chatBranches';

type MessageListProps = {
	conversationId?: string | null;
	onOpenAttachment: (attachment: ChatAttachment) => void;
	onRetry: (userMessageId: string) => void;
	onEdit: (message: ChatMessage, content: string) => void;
	onActivateBranch: (messageId: string) => void;
	canEdit?: boolean;
	onRate: (message: ChatMessage, score: number, comment?: string) => void;
	onRemoveRating: (message: ChatMessage) => void;
	onAddToKnowledge: (message: ChatMessage, attachment?: ChatAttachment) => void;
	onOpenKnowledge: (message: ChatMessage) => void;
	onCreateFile?: (message: ChatMessage) => Promise<void>;
};

type BranchInfo = { variants: ChatMessage[] };
const EMPTY_MESSAGES: ChatMessage[] = [];

function buildDisplay(messages: ChatMessage[]) {
	const groups = new Map<string, ChatMessage[]>();
	for (const message of messages) {
		if (message.role !== 'user') continue;
		const groupId = chatBranchGroupId(message);
		groups.set(groupId, [...(groups.get(groupId) ?? []), message]);
	}
	const branches = new Map<string, BranchInfo>();
	for (const [groupId, variants] of groups) {
		branches.set(groupId, { variants });
	}
	const displayed = getActiveBranchMessages(messages);
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


export function MessageList({ conversationId, onOpenAttachment, onRetry, onEdit, onActivateBranch, onRate, onRemoveRating, onAddToKnowledge, onOpenKnowledge, onCreateFile, canEdit = true }: MessageListProps) {
	const messages = useChatStore((state) => conversationId ? (state.messagesByConversation[conversationId] ?? EMPTY_MESSAGES) : state.messages);
	const { displayed, branches } = buildDisplay(messages);
	const retryMessageIds = getRetryMessageIds(displayed);
	return (
		<div className="message-list">
			{displayed.map((message) => {
				const retryMessageId = retryMessageIds.get(message.id);
				const branchInfo = message.role === 'user' ? branches.get(chatBranchGroupId(message)) : undefined;
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
						onAddToKnowledge={message.role === 'assistant' && message.status === 'done' && message.content.trim() ? (attachment) => onAddToKnowledge(message, attachment) : undefined}
						onOpenKnowledge={message.knowledgeItem ? () => onOpenKnowledge(message) : undefined}
						onCreateFile={onCreateFile && message.role === 'assistant' && message.status === 'done' && message.content.trim() ? () => onCreateFile(message) : undefined}
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
