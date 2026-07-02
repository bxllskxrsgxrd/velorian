import type { ReactNode } from 'react';
import './_dropZone.scss';

type DropZoneProps = {
	children: ReactNode;
	isDragging: boolean;
	onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
	onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
	onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function DropZone({ children, isDragging, onDragOver, onDragLeave, onDrop }: DropZoneProps) {
	return (
		<div className="drop-zone" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
			{children}
			{isDragging && (
				<div className="drop-zone__overlay">
					<div className="drop-zone__overlay-content">Дропай файлы</div>
				</div>
			)}
		</div>
	);
}
