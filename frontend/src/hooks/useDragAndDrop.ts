import React from 'react';
import { useFilesStore } from '../stores/filesStore';

export function useDragAndDrop(conversationId?: string | null) {
	const isDragging = useFilesStore((state) => state.isDragging);
	const files = useFilesStore((state) => state.files);
	const fileError = useFilesStore((state) => state.fileError);
	const addStoreFiles = useFilesStore((state) => state.addFiles);
	const removeFile = useFilesStore((state) => state.removeFile);
	const clearFiles = useFilesStore((state) => state.clearFiles);
	const setIsDragging = useFilesStore((state) => state.setDragging);

	// функция проверяет перетягиваются файлы или нет
	function isFilesDragging(e: React.DragEvent<HTMLElement>) {
		return Array.from(e.dataTransfer.types).includes('Files');
	}

	function addFiles(newFiles: File[]) {
		addStoreFiles(newFiles, conversationId);
	}

	// функция переноса файла в дроп зону
	function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
		if (!isFilesDragging(e)) return;

		e.preventDefault();
		e.stopPropagation();

		setIsDragging(true);
	}

	// функция для переключения на дефолтное состояние при отмене переноса файла
	function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
		if (!isFilesDragging(e)) return;

		e.preventDefault();
		e.stopPropagation();

		const currentTarget = e.currentTarget;
		const relatedTarget = (e.relatedTarget as Node) || null;

		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
			setIsDragging(false);
		}
	}

	// функция поведения дроп-зоны
	function handleDrop(e: React.DragEvent<HTMLDivElement>) {
		if (!isFilesDragging(e)) return;

		e.preventDefault();
		e.stopPropagation();

		setIsDragging(false);

		// массив добавленных файлов из FileList
		const droppedFiles = Array.from(e.dataTransfer.files);

		if (droppedFiles.length === 0) return;

		// функция обновления массива droppedFiles при добавлении новых
		addFiles(droppedFiles);
	}

	return { isDragging, files, fileError, addFiles, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles };
}
