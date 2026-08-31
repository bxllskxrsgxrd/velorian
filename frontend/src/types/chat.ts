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
	knowledgeItemId?: string | null;
};

export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[keyof typeof CHAT_MESSAGE_STATUSES];
export type SearchMode = 'none' | 'web' | 'knowledge';

export type MessageRating = {
	id: string;
	score: number;
	comment?: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ChatMessageError = {
	code: string;
	title: string;
	description: string;
	requestId?: string;
	retryable: boolean;
};

export type KnowledgeSource = {
	id: string;
	title: string;
	sourceType: string;
	rating: number | null;
	approach?: Pick<KnowledgeApproach, 'id' | 'name' | 'slug'> | null;
};

export type KnowledgeApproach = {
	id: string;
	name: string;
	slug: string;
	createdAt: string;
	updatedAt: string;
};

export type KnowledgeFilterOption = {
	id: string;
	value: string;
	normalizedValue: string;
};

export type KnowledgeFilterDefinition = {
	id: string;
	name: string;
	slug: string;
	type: 'single_select';
	isSystem: boolean;
	options: KnowledgeFilterOption[];
	createdAt: string;
	updatedAt: string;
};

export type KnowledgeItemFilter = {
	filterId: string;
	filterName: string;
	filterSlug: string;
	optionId: string;
	value: string;
};

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
	rating?: MessageRating | null;
	error?: ChatMessageError | null;
	/** @deprecated Kept while older API responses are normalized. */
	errorCode?: string;
	requestId?: string;
	searchMode?: SearchMode;
	knowledgeSources?: KnowledgeSource[];
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

export type KnowledgeItem = {
	id: string;
	sourceType: 'assistant_message' | 'assistant_generated_file' | 'uploaded_file' | 'manual' | 'rated_content';
	sourceMessageId?: string | null;
	sourceFileId?: string | null;
	title: string;
	content: string;
	mimeType: string;
	originalFilename?: string | null;
	rating: number | null;
	approach: KnowledgeApproach | null;
	filters: KnowledgeItemFilter[];
	isActive: boolean;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	downloadUrl?: string | null;
};

export type KnowledgePageResult = {
	items: KnowledgeItem[];
	pageInfo: { nextCursor: string | null; hasMore: boolean };
};
