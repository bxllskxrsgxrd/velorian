import { create } from 'zustand';
import type { ConversationSummary } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

type SidebarDialog = { type: 'rename' | 'delete'; conversation: ConversationSummary } | null;

type SidebarStore = {
	conversationMenuId: string | null;
	isAccountOpen: boolean;
	dialog: SidebarDialog;
	draftTitle: string;
	setConversationMenuId: (value: StateValue<string | null>) => void;
	setAccountOpen: (value: StateValue<boolean>) => void;
	setDialog: (dialog: SidebarDialog) => void;
	setDraftTitle: (title: string) => void;
	openDialog: (type: 'rename' | 'delete', conversation: ConversationSummary) => void;
	closeMenus: () => void;
};

export const useSidebarStore = create<SidebarStore>((set) => ({
	conversationMenuId: null,
	isAccountOpen: false,
	dialog: null,
	draftTitle: '',
	setConversationMenuId: (value) =>
		set((state) => ({ conversationMenuId: resolveStateValue(value, state.conversationMenuId) })),
	setAccountOpen: (value) => set((state) => ({ isAccountOpen: resolveStateValue(value, state.isAccountOpen) })),
	setDialog: (dialog) => set({ dialog }),
	setDraftTitle: (draftTitle) => set({ draftTitle }),
	openDialog: (type, conversation) => set({ conversationMenuId: null, draftTitle: conversation.title, dialog: { type, conversation } }),
	closeMenus: () => set({ conversationMenuId: null, isAccountOpen: false }),
}));
