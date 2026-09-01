import { create } from 'zustand';
import type { ChatMessageError, PreviewFile } from '../types/chat';
import { validateAndMergeFiles } from '../utils/fileValidation';
import { reportError } from '../utils/reportError';

type TextPreview = { url: string; content: string } | null;

type FilesStore = {
	files: File[];
	isDragging: boolean;
	fileError: ChatMessageError | null;
	previewFile: PreviewFile | null;
	textPreview: TextPreview;
	addFiles: (files: File[], conversationId?: string | null) => void;
	removeFile: (index: number) => void;
	clearFiles: () => void;
	setDragging: (dragging: boolean) => void;
	setPreviewFile: (file: PreviewFile | null) => void;
	setTextPreview: (preview: TextPreview) => void;
	reset: () => void;
};

export const useFilesStore = create<FilesStore>((set) => ({
	files: [],
	isDragging: false,
	fileError: null,
	previewFile: null,
	textPreview: null,
	addFiles: (newFiles, conversationId) => {
		if (newFiles.length === 0) return;
		set((state) => {
			const result = validateAndMergeFiles(state.files, newFiles);
			if (result.error) {
				reportError(result.error.code, new Error(result.error.description), {
					...result.diagnostics,
					...(conversationId ? { conversationId } : {}),
				});
			}
			return { files: result.files, fileError: result.error ?? null };
		});
	},
	removeFile: (index) =>
		set((state) => ({ files: state.files.filter((_, currentIndex) => currentIndex !== index), fileError: null })),
	clearFiles: () => set({ files: [], fileError: null }),
	setDragging: (isDragging) => set({ isDragging }),
	setPreviewFile: (previewFile) => set({ previewFile }),
	setTextPreview: (textPreview) => set({ textPreview }),
	reset: () => set({ files: [], isDragging: false, fileError: null, previewFile: null, textPreview: null }),
}));
