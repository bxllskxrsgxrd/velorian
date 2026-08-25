import type { CHAT_MESSAGE_STATUSES } from '../constants/chatMessageStatuses';
import type { CHAT_ROLES } from '../constants/chatRoles';

// нужно, чтобы взять все значения из объекта CHAT_ROLES и сделать из них union-тип
export type ChatRole = (typeof CHAT_ROLES)[keyof typeof CHAT_ROLES];

export type ChatAttachment = {
	id: string;
	name: string;
	size: number;
	type: string;
	url: string;
	downloadUrl?: string;
	isImage: boolean;
	extractionStatus?: 'ready' | 'empty' | 'ocr_unavailable' | 'unsupported' | 'generated';
	generated?: boolean;
};

export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[keyof typeof CHAT_MESSAGE_STATUSES];

export type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	status?: ChatMessageStatus;
	attachments?: ChatAttachment[];
	createdAt?: string;
	branchGroupId?: string | null;
	replyToId?: string | null;
	isActive?: boolean;
};

export type PreviewFile = {
	name: string;
	size: number;
	type: string;
	url: string;
	revokeOnClose?: boolean;
};

export type ConversationSummary = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
};

export type Conversation = ConversationSummary & {
	messages: ChatMessage[];
};

export type AuthUser = {
	id: string;
	email: string;
};
