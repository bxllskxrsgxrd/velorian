import { create } from 'zustand';
import type { SearchMode } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

type PromptStore = {
	value: string;
	searchMode: SearchMode;
	isMultiline: boolean;
	setValue: (value: StateValue<string>) => void;
	setSearchMode: (mode: SearchMode) => void;
	setMultiline: (multiline: boolean) => void;
	reset: () => void;
	restore: (value: string, searchMode: SearchMode) => void;
};

export const usePromptStore = create<PromptStore>((set) => ({
	value: '',
	searchMode: 'none',
	isMultiline: false,
	setValue: (value) => set((state) => ({ value: resolveStateValue(value, state.value) })),
	setSearchMode: (searchMode) => set({ searchMode }),
	setMultiline: (isMultiline) => set({ isMultiline }),
	reset: () => set({ value: '', searchMode: 'none', isMultiline: false }),
	restore: (value, searchMode) => set({ value, searchMode }),
}));
