import { useEffect, useState } from 'react';

export function useDragAndDrop() {
	const [isDragging, setIsDragging] = useState(false);
	const [files, setFiles] = useState<File[]>([]);

	// функция переноса файла
	function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();

		setIsDragging(true);
	}

	function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();

		const currentTarget = e.currentTarget;
		const relatedTarget = (e.relatedTarget as Node) || null;

		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
			setIsDragging(false);
		}
	}

	useEffect(() => {
		console.log(files);
	}, [files]);

	function handleDrop(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();

		setIsDragging(false);

		const droppedFiles = Array.from(e.dataTransfer.files);

		if (droppedFiles.length === 0) return;

		setFiles((prev) => [...prev, ...droppedFiles]);
	}

	function removeFile(index: number) {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	}

	function clearFiles() {
		setFiles([]);
	}

	return { isDragging, files, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles };
}
