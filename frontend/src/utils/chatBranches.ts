import type { ChatMessage } from '../types/chat';

export function chatBranchGroupId(message: ChatMessage) {
	return message.branchGroupId || message.id;
}

export function getMessageParentIds(messages: ChatMessage[]) {
	const parentIds = new Map<string, string | null>();
	const groupParentIds = new Map<string, string | null>();
	let previousAssistantId: string | null = null;

	for (const message of messages) {
		if (message.role === 'user') {
			const groupId = chatBranchGroupId(message);
			const parentId = message.replyToId ?? (
				groupParentIds.has(groupId) ? groupParentIds.get(groupId)! : previousAssistantId
			);
			if (!groupParentIds.has(groupId)) groupParentIds.set(groupId, parentId);
			parentIds.set(message.id, parentId);
		} else {
			parentIds.set(message.id, message.replyToId ?? null);
			previousAssistantId = message.id;
		}
	}

	return parentIds;
}

export function getActiveBranchMessages(messages: ChatMessage[]) {
	const messagesById = new Map(messages.map((message) => [message.id, message]));
	const parentIds = getMessageParentIds(messages);
	const visibility = new Map<string, boolean>();

	function isVisible(messageId: string, visiting = new Set<string>()): boolean {
		const saved = visibility.get(messageId);
		if (saved !== undefined) return saved;
		const message = messagesById.get(messageId);
		if (!message || visiting.has(messageId)) return false;
		if (message.role === 'user' && message.isActive === false) {
			visibility.set(messageId, false);
			return false;
		}
		const parentId = parentIds.get(messageId);
		if (!parentId) {
			visibility.set(messageId, true);
			return true;
		}
		visiting.add(messageId);
		const result = isVisible(parentId, visiting);
		visiting.delete(messageId);
		visibility.set(messageId, result);
		return result;
	}

	return messages.filter((message) => isVisible(message.id));
}

export function getMessageParentId(messages: ChatMessage[], messageId: string) {
	return getMessageParentIds(messages).get(messageId) ?? null;
}

export function getActiveBranchLeafAssistantId(messages: ChatMessage[]) {
	return getActiveBranchMessages(messages).findLast((message) => message.role === 'assistant')?.id ?? null;
}
