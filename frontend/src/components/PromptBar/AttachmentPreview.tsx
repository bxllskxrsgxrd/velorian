import { useEffect, useState } from 'react';
import { DeleteAttachmentIcon } from '../icons/DeleteAttachmentIcon';
import { DocumentIcon } from '../icons/DocumentIcon';
import { IconButton } from '../ui/IconButton/IconButton';

type AttachmentPreviewProps = {
	file: File;
	onRemove: () => void;
	onOpen: (file: File) => void;
};

export function AttachmentPreview({ file, onRemove, onOpen }: AttachmentPreviewProps) {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	const isImage = file.type.startsWith('image/');

	useEffect(() => {
		if (!isImage) {
			setPreviewUrl(null);
			return;
		}

		const url = URL.createObjectURL(file);

		setPreviewUrl(url);

		return () => {
			URL.revokeObjectURL(url);
		};
	}, [file, isImage]);

	return (
		<div
			className={
				isImage ? 'prompt-bar__attachments-item prompt-bar__attachments-image' : 'prompt-bar__attachments-item'
			}
		>
			<button className="prompt-bar__attachments-open-button" type="button" onClick={() => onOpen(file)}>
				{previewUrl ? (
					<img src={previewUrl} alt={`${file.name}`} className="prompt-bar__attachments-image" />
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
