import { create } from 'zustand';
import type { SearchMode } from '../types/chat';
import { resolveStateValue, type StateValue } from './storeTypes';

type PromptStore = {
	value: string;
	searchMode: SearchMode;
	isListening: boolean;
	isMultiline: boolean;
	setValue: (value: StateValue<string>) => void;
	setSearchMode: (mode: SearchMode) => void;
	setListening: (listening: boolean) => void;
	setMultiline: (multiline: boolean) => void;
	reset: () => void;
	restore: (value: string, searchMode: SearchMode) => void;
};

export const usePromptStore = create<PromptStore>((set) => ({
	value: '',
	searchMode: 'none',
	isListening: false,
	isMultiline: false,
	setValue: (value) => set((state) => ({ value: resolveStateValue(value, state.value) })),
	setSearchMode: (searchMode) => set({ searchMode }),
	setListening: (isListening) => set({ isListening }),
	setMultiline: (isMultiline) => set({ isMultiline }),
	reset: () => set({ value: '', searchMode: 'none', isListening: false, isMultiline: false }),
	restore: (value, searchMode) => set({ value, searchMode }),
}));
