import { create } from 'zustand';
import { EMPTY_KNOWLEDGE_FILTERS } from '../constants/knowledgeFilters';
import type { ChatAttachment, ChatMessage, KnowledgeFilters } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

export type KnowledgeSaveState = 'idle' | 'loading' | 'success' | 'error';

type ChatStore = {
	messages: ChatMessage[];
	isGenerating: boolean;
	isLoadingConversation: boolean;
	isCreatingConversation: boolean;
	pageError: string;
	promptResetSequence: number;
	knowledgeAttachment: ChatAttachment | null;
	knowledgeFilters: KnowledgeFilters;
	knowledgeSaveState: KnowledgeSaveState;
	setMessages: (value: StateValue<ChatMessage[]>) => void;
	setGenerating: (value: boolean) => void;
	setLoadingConversation: (value: boolean) => void;
	setCreatingConversation: (value: boolean) => void;
	setPageError: (value: string) => void;
	resetPrompt: () => void;
	openKnowledgeAttachment: (attachment: ChatAttachment) => void;
	closeKnowledgeAttachment: () => void;
	setKnowledgeFilters: (filters: KnowledgeFilters) => void;
	setKnowledgeSaveState: (value: KnowledgeSaveState) => void;
	resetConversation: () => void;
};

export const useChatStore = create<ChatStore>((set) => ({
	messages: [],
	isGenerating: false,
	isLoadingConversation: false,
	isCreatingConversation: false,
	pageError: '',
	promptResetSequence: 0,
	knowledgeAttachment: null,
	knowledgeFilters: { ...EMPTY_KNOWLEDGE_FILTERS },
	knowledgeSaveState: 'idle',
	setMessages: (value) => set((state) => ({ messages: resolveStateValue(value, state.messages) })),
	setGenerating: (isGenerating) => set({ isGenerating }),
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
	resetConversation: () =>
		set({
			messages: [],
			isGenerating: false,
			isLoadingConversation: false,
			isCreatingConversation: false,
			pageError: '',
		}),
}));
