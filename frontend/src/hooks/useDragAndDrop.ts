import React, { useState } from 'react';
import { validateAndMergeFiles } from '../utils/fileValidation';
import type { ChatMessageError } from '../types/chat';
import { reportError } from '../utils/reportError';

export function useDragAndDrop(conversationId?: string | null) {
	const [isDragging, setIsDragging] = useState(false);
	const [files, setFiles] = useState<File[]>([]);
	const [fileError, setFileError] = useState<ChatMessageError | null>(null);

	// функция проверяет перетягиваются файлы или нет
	function isFilesDragging(e: React.DragEvent<HTMLElement>) {
		return Array.from(e.dataTransfer.types).includes('Files');
	}

	function addFiles(newFiles: File[]) {
		if (newFiles.length === 0) return;
		setFiles((currentFiles) => {
			const result = validateAndMergeFiles(currentFiles, newFiles);
			setFileError(result.error ?? null);
			if (result.error) reportError(result.error.code, new Error(result.error.description), {
				...result.diagnostics,
				...(conversationId ? { conversationId } : {}),
			});
			return result.files;
		});
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

	// функция удаления файлов из массива под индексу
	function removeFile(index: number) {
		setFiles((prev) => prev.filter((_, i) => i !== index));
		setFileError(null);
	}

	// функция полной очистки массива
	function clearFiles() {
		setFiles([]);
		setFileError(null);
	}

	return { isDragging, files, fileError, addFiles, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles };
}
