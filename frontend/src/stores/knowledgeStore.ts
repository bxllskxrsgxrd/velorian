import { create } from 'zustand';
import { EMPTY_KNOWLEDGE_FILTERS } from '../constants/knowledgeFilters';
import type { KnowledgeApproach, KnowledgeFilters, KnowledgeItem } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

export type KnowledgeDialog =
	| { type: 'view' | 'edit' | 'delete'; item: KnowledgeItem }
	| { type: 'add' }
	| null;

function itemFilters(item: KnowledgeItem): KnowledgeFilters {
	return (
		item.filters ?? {
			geo: typeof item.metadata?.geo === 'string' ? item.metadata.geo : null,
			celebrity: typeof item.metadata?.celebrity === 'string' ? item.metadata.celebrity : null,
			offer: typeof item.metadata?.offer === 'string' ? item.metadata.offer : null,
			news_source: typeof item.metadata?.news_source === 'string' ? item.metadata.news_source : null,
		}
	);
}

type KnowledgeStore = {
	items: KnowledgeItem[];
	deletedItems: KnowledgeItem[];
	nextCursor: string | null;
	search: string;
	isLoading: boolean;
	isLoadingMore: boolean;
	dialog: KnowledgeDialog;
	title: string;
	content: string;
	rating: number | null;
	isActive: boolean;
	selectedApproachId: string;
	formFilters: KnowledgeFilters;
	isSaving: boolean;
	approaches: KnowledgeApproach[];
	newApproachName: string;
	showApproachCreator: boolean;
	isCreatingApproach: boolean;
	file: File | null;
	pendingItemIds: Set<string>;
	setItems: (value: StateValue<KnowledgeItem[]>) => void;
	setDeletedItems: (value: StateValue<KnowledgeItem[]>) => void;
	upsertItem: (item: KnowledgeItem) => void;
	removeDeletedItem: (id: string) => void;
	setNextCursor: (cursor: string | null) => void;
	setSearch: (search: string) => void;
	setLoading: (loading: boolean) => void;
	setLoadingMore: (loading: boolean) => void;
	setDialog: (dialog: KnowledgeDialog) => void;
	setTitle: (title: string) => void;
	setContent: (content: string) => void;
	setRating: (rating: number | null) => void;
	setActive: (active: boolean) => void;
	setSelectedApproachId: (id: string) => void;
	setFormFilters: (filters: KnowledgeFilters) => void;
	setSaving: (saving: boolean) => void;
	setApproaches: (value: StateValue<KnowledgeApproach[]>) => void;
	setNewApproachName: (name: string) => void;
	setShowApproachCreator: (show: boolean) => void;
	setCreatingApproach: (creating: boolean) => void;
	setFile: (file: File | null) => void;
	markPending: (id: string, pending: boolean) => void;
	openAdd: () => void;
	openEdit: (item: KnowledgeItem) => void;
	resetApproachCreator: () => void;
	reset: () => void;
};

export const useKnowledgeStore = create<KnowledgeStore>((set) => ({
	items: [],
	deletedItems: [],
	nextCursor: null,
	search: '',
	isLoading: true,
	isLoadingMore: false,
	dialog: null,
	title: '',
	content: '',
	rating: null,
	isActive: true,
	selectedApproachId: '',
	formFilters: { ...EMPTY_KNOWLEDGE_FILTERS },
	isSaving: false,
	approaches: [],
	newApproachName: '',
	showApproachCreator: false,
	isCreatingApproach: false,
	file: null,
	pendingItemIds: new Set(),
	setItems: (value) => set((state) => ({ items: resolveStateValue(value, state.items) })),
	setDeletedItems: (value) => set((state) => ({ deletedItems: resolveStateValue(value, state.deletedItems) })),
	upsertItem: (item) => set((state) => ({ items: [item, ...state.items.filter((entry) => entry.id !== item.id)] })),
	removeDeletedItem: (id) => set((state) => ({ deletedItems: state.deletedItems.filter((item) => item.id !== id) })),
	setNextCursor: (nextCursor) => set({ nextCursor }),
	setSearch: (search) => set({ search }),
	setLoading: (isLoading) => set({ isLoading }),
	setLoadingMore: (isLoadingMore) => set({ isLoadingMore }),
	setDialog: (dialog) => set({ dialog }),
	setTitle: (title) => set({ title }),
	setContent: (content) => set({ content }),
	setRating: (rating) => set({ rating }),
	setActive: (isActive) => set({ isActive }),
	setSelectedApproachId: (selectedApproachId) => set({ selectedApproachId }),
	setFormFilters: (formFilters) => set({ formFilters }),
	setSaving: (isSaving) => set({ isSaving }),
	setApproaches: (value) => set((state) => ({ approaches: resolveStateValue(value, state.approaches) })),
	setNewApproachName: (newApproachName) => set({ newApproachName }),
	setShowApproachCreator: (showApproachCreator) => set({ showApproachCreator }),
	setCreatingApproach: (isCreatingApproach) => set({ isCreatingApproach }),
	setFile: (file) => set({ file }),
	markPending: (id, pending) =>
		set((state) => {
			const pendingItemIds = new Set(state.pendingItemIds);
			if (pending) pendingItemIds.add(id);
			else pendingItemIds.delete(id);
			return { pendingItemIds };
		}),
	openAdd: () =>
		set({
			title: '',
			content: '',
			rating: null,
			isActive: true,
			selectedApproachId: '',
			formFilters: { ...EMPTY_KNOWLEDGE_FILTERS },
			file: null,
			isSaving: false,
			newApproachName: '',
			showApproachCreator: false,
			dialog: { type: 'add' },
		}),
	openEdit: (item) =>
		set({
			title: item.title,
			content: item.content,
			rating: item.rating,
			isActive: item.isActive,
			selectedApproachId: item.approach?.id ?? '',
			formFilters: itemFilters(item),
			file: null,
			isSaving: false,
			newApproachName: '',
			showApproachCreator: false,
			dialog: { type: 'edit', item },
		}),
	resetApproachCreator: () => set({ newApproachName: '', showApproachCreator: false }),
	reset: () =>
		set({
			items: [],
			deletedItems: [],
			nextCursor: null,
			search: '',
			isLoading: true,
			isLoadingMore: false,
			dialog: null,
			title: '',
			content: '',
			rating: null,
			isActive: true,
			selectedApproachId: '',
			formFilters: { ...EMPTY_KNOWLEDGE_FILTERS },
			isSaving: false,
			approaches: [],
			newApproachName: '',
			showApproachCreator: false,
			isCreatingApproach: false,
			file: null,
			pendingItemIds: new Set(),
		}),
}));
