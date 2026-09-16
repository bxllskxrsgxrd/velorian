import { create } from 'zustand';
import { createApproach, deleteApproach, getApproach, listApproaches, updateApproach } from '../api/chatApi';
import type { Approach, ApproachInput } from '../types/chat';

type ApproachesStore = {
	items: Approach[];
	isLoading: boolean;
	isSaving: boolean;
	load: () => Promise<Approach[]>;
	loadOne: (id: string) => Promise<Approach>;
	create: (value: ApproachInput) => Promise<Approach>;
	update: (id: string, value: Partial<ApproachInput>) => Promise<Approach>;
	deactivate: (id: string) => Promise<Approach>;
	delete: (id: string) => Promise<void>;
	reset: () => void;
};

function sorted(items: Approach[]) {
	return [...items].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

export const useApproachesStore = create<ApproachesStore>((set, get) => ({
	items: [],
	isLoading: false,
	isSaving: false,
	load: async () => {
		set({ isLoading: true });
		try {
			const items = await listApproaches();
			set({ items: sorted(items) });
			return items;
		} finally {
			set({ isLoading: false });
		}
	},
	loadOne: async (id) => {
		const existing = get().items.find((item) => item.id === id);
		if (existing) return existing;
		const item = await getApproach(id);
		set((state) => ({ items: sorted([...state.items.filter((entry) => entry.id !== id), item]) }));
		return item;
	},
	create: async (value) => {
		set({ isSaving: true });
		try {
			const item = await createApproach(value);
			set((state) => ({ items: sorted([...state.items, item]) }));
			return item;
		} finally {
			set({ isSaving: false });
		}
	},
	update: async (id, value) => {
		set({ isSaving: true });
		try {
			const item = await updateApproach(id, value);
			set((state) => ({ items: sorted(state.items.map((entry) => entry.id === id ? item : entry)) }));
			return item;
		} finally {
			set({ isSaving: false });
		}
	},
	deactivate: async (id) => get().update(id, { isActive: false }),
	delete: async (id) => {
		await deleteApproach(id);
		const items = await listApproaches();
		set({ items: sorted(items) });
	},
	reset: () => set({ items: [], isLoading: false, isSaving: false }),
}));
