import { create } from 'zustand';

type FileCreationState = 'idle' | 'loading' | 'success' | 'error';
type MessageUiState = {
	isEditing?: boolean;
	draft?: string;
	fileState?: FileCreationState;
	isCommentOpen?: boolean;
	comment?: string;
};

type MessageUiStore = {
	byMessageId: Record<string, MessageUiState>;
	startEditing: (id: string, content: string) => void;
	cancelEditing: (id: string, content: string) => void;
	finishEditing: (id: string) => void;
	setDraft: (id: string, draft: string) => void;
	setFileState: (id: string, state: FileCreationState) => void;
	toggleComment: (id: string, initialComment: string) => void;
	setComment: (id: string, comment: string) => void;
	closeComment: (id: string) => void;
	reset: () => void;
};

export const useMessageUiStore = create<MessageUiStore>((set) => ({
	byMessageId: {},
	startEditing: (id, draft) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], isEditing: true, draft } } })),
	cancelEditing: (id, draft) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], isEditing: false, draft } } })),
	finishEditing: (id) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], isEditing: false } } })),
	setDraft: (id, draft) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], draft } } })),
	setFileState: (id, fileState) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], fileState } } })),
	toggleComment: (id, initialComment) =>
		set((state) => {
			const current = state.byMessageId[id];
			return {
				byMessageId: {
					...state.byMessageId,
					[id]: {
						...current,
						isCommentOpen: !current?.isCommentOpen,
						comment: current?.comment ?? initialComment,
					},
				},
			};
		}),
	setComment: (id, comment) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], comment } } })),
	closeComment: (id) =>
		set((state) => ({ byMessageId: { ...state.byMessageId, [id]: { ...state.byMessageId[id], isCommentOpen: false } } })),
	reset: () => set({ byMessageId: {} }),
}));
