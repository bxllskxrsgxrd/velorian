import { useFilesStore } from '../stores/filesStore';

export function useDragAndDrop(conversationId?: string | null) {
	const files = useFilesStore((state) => state.files);
	const fileError = useFilesStore((state) => state.fileError);
	const addStoreFiles = useFilesStore((state) => state.addFiles);
	const removeFile = useFilesStore((state) => state.removeFile);
	const clearFiles = useFilesStore((state) => state.clearFiles);

	function addFiles(newFiles: File[]) {
		addStoreFiles(newFiles, conversationId);
	}

	return { files, fileError, addFiles, removeFile, clearFiles };
}
