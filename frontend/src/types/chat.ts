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

export type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	attachments?: ChatAttachment[];
};

export type PreviewFile = {
	name: string;
	size: number;
	type: string;
	url: string;
	revokeOnClose?: boolean;
};
