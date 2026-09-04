import { create } from 'zustand';
import type { ConversationSummary } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

type ConversationsStore = {
	conversations: ConversationSummary[];
	deletedConversations: ConversationSummary[];
	search: string;
	setConversations: (value: StateValue<ConversationSummary[]>) => void;
	setDeletedConversations: (value: StateValue<ConversationSummary[]>) => void;
	setSearch: (search: string) => void;
	upsertConversation: (conversation: ConversationSummary) => void;
	removeConversation: (id: string) => void;
	removeDeletedConversation: (id: string) => void;
	touchConversation: (id: string, title?: string) => void;
	reset: () => void;
};

export const useConversationsStore = create<ConversationsStore>((set) => ({
	conversations: [],
	deletedConversations: [],
	search: '',
	setConversations: (value) => set((state) => ({ conversations: resolveStateValue(value, state.conversations) })),
	setDeletedConversations: (value) => set((state) => ({
		deletedConversations: resolveStateValue(value, state.deletedConversations),
	})),
	setSearch: (search) => set({ search }),
	upsertConversation: (conversation) =>
		set((state) => ({
			conversations: [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)],
		})),
	removeConversation: (id) =>
		set((state) => ({ conversations: state.conversations.filter((item) => item.id !== id) })),
	removeDeletedConversation: (id) =>
		set((state) => ({ deletedConversations: state.deletedConversations.filter((item) => item.id !== id) })),
	touchConversation: (id, title) =>
		set((state) => {
			const current = state.conversations.find((item) => item.id === id);
			if (!current) return state;
			const updated = { ...current, title: title ?? current.title, updatedAt: new Date().toISOString() };
			return { conversations: [updated, ...state.conversations.filter((item) => item.id !== id)] };
		}),
	reset: () => set({ conversations: [], deletedConversations: [], search: '' }),
}));
