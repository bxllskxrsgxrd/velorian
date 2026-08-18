import React, { useState } from 'react';
import { validateAndMergeFiles } from '../utils/fileValidation';

export function useDragAndDrop() {
	const [isDragging, setIsDragging] = useState(false);
	const [files, setFiles] = useState<File[]>([]);
	const [fileError, setFileError] = useState('');

	// функция проверяет перетягиваются файлы или нет
	function isFilesDragging(e: React.DragEvent<HTMLElement>) {
		return Array.from(e.dataTransfer.types).includes('Files');
	}

	function addFiles(newFiles: File[]) {
		if (newFiles.length === 0) return;
		const result = validateAndMergeFiles(files, newFiles);
		setFileError(result.error);
		setFiles(result.files);
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
		setFileError('');
	}

	// функция полной очистки массива
	function clearFiles() {
		setFiles([]);
		setFileError('');
	}

	return { isDragging, files, fileError, addFiles, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles };
}
