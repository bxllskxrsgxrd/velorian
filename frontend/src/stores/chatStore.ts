import { create } from 'zustand';
import { EMPTY_KNOWLEDGE_FILTERS } from '../constants/knowledgeFilters';
import type { ChatAttachment, ChatMessage, KnowledgeFilters, KnowledgeItem } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

export type KnowledgeSaveState = 'idle' | 'loading' | 'success' | 'error';

export type ChatGenerationState = {
	status: 'streaming';
	assistantMessageId: string;
};

type KnowledgeLinkUpdate = Pick<KnowledgeItem, 'id' | 'deletedAt'> &
	Partial<Pick<KnowledgeItem, 'rating' | 'updatedAt'>>;

function ratingFromKnowledge(message: ChatMessage, item: KnowledgeLinkUpdate): ChatMessage['rating'] {
	if (!Object.prototype.hasOwnProperty.call(item, 'rating')) return message.rating;
	if (item.rating == null) return null;
	const timestamp = item.updatedAt ?? new Date().toISOString();
	return {
		id: message.rating?.id ?? `knowledge-${item.id}`,
		score: item.rating,
		comment: message.rating?.comment ?? null,
		createdAt: message.rating?.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
}

type ChatStore = {
	messagesByConversation: Record<string, ChatMessage[]>;
	generationByConversation: Record<string, ChatGenerationState>;
	messages: ChatMessage[];
	isLoadingConversation: boolean;
	isCreatingConversation: boolean;
	pageError: string;
	promptResetSequence: number;
	knowledgeAttachment: ChatAttachment | null;
	knowledgeFilters: KnowledgeFilters;
	knowledgeSaveState: KnowledgeSaveState;
	setConversationMessages: (conversationId: string, value: StateValue<ChatMessage[]>) => void;
	setMessages: (value: StateValue<ChatMessage[]>) => void;
	setConversationGeneration: (conversationId: string, value: ChatGenerationState) => void;
	clearConversationGeneration: (conversationId: string) => void;
	removeConversationState: (conversationId: string) => void;
	setLoadingConversation: (value: boolean) => void;
	setCreatingConversation: (value: boolean) => void;
	setPageError: (value: string) => void;
	resetPrompt: () => void;
	openKnowledgeAttachment: (attachment: ChatAttachment) => void;
	closeKnowledgeAttachment: () => void;
	setKnowledgeFilters: (filters: KnowledgeFilters) => void;
	setKnowledgeSaveState: (value: KnowledgeSaveState) => void;
	syncKnowledgeLink: (sourceMessageId: string, item: KnowledgeLinkUpdate) => void;
	removeKnowledgeLink: (itemId: string) => void;
	resetConversation: () => void;
};

export const useChatStore = create<ChatStore>((set) => ({
	messagesByConversation: {},
	generationByConversation: {},
	messages: [],
	isLoadingConversation: false,
	isCreatingConversation: false,
	pageError: '',
	promptResetSequence: 0,
	knowledgeAttachment: null,
	knowledgeFilters: { ...EMPTY_KNOWLEDGE_FILTERS },
	knowledgeSaveState: 'idle',
	setConversationMessages: (conversationId, value) =>
		set((state) => {
			const current = state.messagesByConversation[conversationId] ?? [];
			let messages = resolveStateValue(value, current);
			if (typeof value !== 'function') {
				const savedLinks = new Map(
					current
						.filter((message) => message.knowledgeItem && Object.prototype.hasOwnProperty.call(message.knowledgeItem, 'rating'))
						.map((message) => [message.knowledgeItem!.id, message.knowledgeItem!]),
				);
				messages = messages.map((message) => {
					const savedLink = message.knowledgeItem ? savedLinks.get(message.knowledgeItem.id) : undefined;
					if (!savedLink) return message;
					const knowledgeItem = {
						...message.knowledgeItem,
						rating: savedLink.rating,
						updatedAt: savedLink.updatedAt,
					};
					return { ...message, knowledgeItem, rating: ratingFromKnowledge(message, knowledgeItem) };
				});
			}
			return { messagesByConversation: { ...state.messagesByConversation, [conversationId]: messages } };
		}),
	setMessages: (value) => set((state) => ({ messages: resolveStateValue(value, state.messages) })),
	setConversationGeneration: (conversationId, value) =>
		set((state) => ({
			generationByConversation: { ...state.generationByConversation, [conversationId]: value },
		})),
	clearConversationGeneration: (conversationId) =>
		set((state) => {
			const generationByConversation = { ...state.generationByConversation };
			delete generationByConversation[conversationId];
			return { generationByConversation };
		}),
	removeConversationState: (conversationId) =>
		set((state) => {
			const messagesByConversation = { ...state.messagesByConversation };
			const generationByConversation = { ...state.generationByConversation };
			delete messagesByConversation[conversationId];
			delete generationByConversation[conversationId];
			return { messagesByConversation, generationByConversation };
		}),
	setLoadingConversation: (isLoadingConversation) => set({ isLoadingConversation }),
	setCreatingConversation: (isCreatingConversation) => set({ isCreatingConversation }),
	setPageError: (pageError) => set({ pageError }),
	resetPrompt: () => set((state) => ({ promptResetSequence: state.promptResetSequence + 1 })),
	openKnowledgeAttachment: (knowledgeAttachment) =>
		set({
			knowledgeAttachment,
			knowledgeFilters: { ...EMPTY_KNOWLEDGE_FILTERS },
			knowledgeSaveState: 'idle',
		}),
	closeKnowledgeAttachment: () => set({ knowledgeAttachment: null }),
	setKnowledgeFilters: (knowledgeFilters) => set({ knowledgeFilters }),
	setKnowledgeSaveState: (knowledgeSaveState) => set({ knowledgeSaveState }),
	syncKnowledgeLink: (sourceMessageId, item) =>
		set((state) => {
			return {
				messagesByConversation: Object.fromEntries(
					Object.entries(state.messagesByConversation).map(([conversationId, messages]) => [
						conversationId,
						messages.map((message) => {
							if (message.id !== sourceMessageId && message.knowledgeItem?.id !== item.id) return message;
							return { ...message, knowledgeItem: item, rating: ratingFromKnowledge(message, item) };
						}),
					]),
				),
			};
		}),
	removeKnowledgeLink: (itemId) =>
		set((state) => ({
			messagesByConversation: Object.fromEntries(
				Object.entries(state.messagesByConversation).map(([conversationId, messages]) => [
					conversationId,
					messages.map((message) => message.knowledgeItem?.id === itemId ? { ...message, knowledgeItem: null } : message),
				]),
			),
		})),
	resetConversation: () =>
		set({
			messagesByConversation: {},
			generationByConversation: {},
			messages: [],
			isLoadingConversation: false,
			isCreatingConversation: false,
			pageError: '',
		}),
}));
