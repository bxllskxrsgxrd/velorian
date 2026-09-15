import { useState, type DragEvent, type ReactNode } from 'react';
import './_dropZone.scss';
import { DropZoneIcons } from '../../icons/DropZoneIcons';

type DropZoneProps = {
	children: ReactNode | ((isDragging: boolean) => ReactNode);
	className?: string;
	overlayLabel?: string;
	showOverlay?: boolean;
	onFilesDrop: (files: File[]) => void;
}

export function DropZone({
	children,
	className,
	overlayLabel = 'Добавить файлы',
	showOverlay = true,
	onFilesDrop,
}: DropZoneProps) {
	const [internalIsDragging, setInternalIsDragging] = useState(false);

	function isFilesDragging(e: DragEvent<HTMLDivElement>) {
		return Array.from(e.dataTransfer.types).includes('Files');
	}

	function handleDragOver(e: DragEvent<HTMLDivElement>) {
		if (!isFilesDragging(e)) return;
		e.preventDefault();
		e.stopPropagation();
		setInternalIsDragging(true);
	}

	function handleDragLeave(e: DragEvent<HTMLDivElement>) {
		if (!isFilesDragging(e)) return;
		e.preventDefault();
		e.stopPropagation();

		const relatedTarget = (e.relatedTarget as Node) || null;
		if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) setInternalIsDragging(false);
	}

	function handleDrop(e: DragEvent<HTMLDivElement>) {
		if (!isFilesDragging(e)) return;
		e.preventDefault();
		e.stopPropagation();
		setInternalIsDragging(false);

		const droppedFiles = Array.from(e.dataTransfer.files);
		if (droppedFiles.length > 0) onFilesDrop(droppedFiles);
	}

	return (
		<div
			className={['drop-zone', className].filter(Boolean).join(' ')}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{typeof children === 'function' ? children(internalIsDragging) : children}
			{showOverlay && internalIsDragging && (
				<div className="drop-zone__overlay">
					<DropZoneIcons />
					<div className="drop-zone__overlay-content">{overlayLabel}</div>
				</div>
			)}
		</div>
	);
}
