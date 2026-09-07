import { useEffect, useRef } from 'react';
import { CrossIcon } from '../icons/AppIcons';
import { DocumentIcon } from '../icons/AppIcons';
import { IconButton } from '../ui/IconButton/IconButton';

type AttachmentPreviewProps = {
	file: File;
	onRemove: () => void;
	onOpen: (file: File) => void;
};

export function AttachmentPreview({ file, onRemove, onOpen }: AttachmentPreviewProps) {
	const isImage = file.type.startsWith('image/');
	const imageRef = useRef<HTMLImageElement>(null);

	useEffect(() => {
		const imageElement = imageRef.current;

		if (!isImage || !imageElement) return;

		const nextPreviewUrl = URL.createObjectURL(file);
		imageElement.src = nextPreviewUrl;

		return () => {
			imageElement.removeAttribute('src');
			URL.revokeObjectURL(nextPreviewUrl);
		};
	}, [file, isImage]);

	const itemClassName = ['prompt-bar__attachments-item', isImage && 'prompt-bar__attachments-item--image']
		.filter(Boolean)
		.join(' ');

	const openButtonClassName = [
		'prompt-bar__attachments-open-button',
		isImage && 'prompt-bar__attachments-open-button--image',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div className={itemClassName}>
			<button className={openButtonClassName} type="button" onClick={() => onOpen(file)}>
				{isImage ? (
					<img ref={imageRef} alt={file.name} className="prompt-bar__attachments-preview" />
				) : (
					<>
						<div className="prompt-bar__attachments-item-icon">
							<DocumentIcon />
						</div>

						<span className="prompt-bar__attachments-item-name">{file.name}</span>
					</>
				)}
			</button>

			<IconButton
				className="prompt-bar__attachments-delete-button"
				onClick={(e) => {
					e.stopPropagation();
					onRemove();
				}}
				aria-label="Удалить файл"
			>
				<CrossIcon />
			</IconButton>
		</div>
	);
}
