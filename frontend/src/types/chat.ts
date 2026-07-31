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
	isImage: boolean;
};

export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[keyof typeof CHAT_MESSAGE_STATUSES];

export type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	status?: ChatMessageStatus;
	attachments?: ChatAttachment[];
};

export type PreviewFile = {
	name: string;
	size: number;
	type: string;
	url: string;
	revokeOnClose?: boolean;
};
