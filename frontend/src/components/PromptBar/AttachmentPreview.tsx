import { useEffect, useMemo } from 'react';
import { DeleteAttachmentIcon } from '../icons/DeleteAttachmentIcon';
import { DocumentIcon } from '../icons/DocumentIcon';
import { IconButton } from '../ui/IconButton/IconButton';

type AttachmentPreviewProps = {
	file: File;
	onRemove: () => void;
	onOpen: (file: File) => void;
};

export function AttachmentPreview({ file, onRemove, onOpen }: AttachmentPreviewProps) {
	const isImage = file.type.startsWith('image/');
	const previewUrl = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);

	useEffect(() => {
		return () => {
			if (previewUrl) URL.revokeObjectURL(previewUrl);
		};
	}, [previewUrl]);

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
					previewUrl && <img src={previewUrl} alt={`${file.name}`} className="prompt-bar__attachments-preview" />
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
				<DeleteAttachmentIcon />
			</IconButton>
		</div>
	);
}
