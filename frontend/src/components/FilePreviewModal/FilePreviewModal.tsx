import { useEffect, useState } from 'react';
import type { PreviewFile } from '../../types/chat';
import { isTextPreview } from '../../utils/files';
import { DeleteAttachmentIcon } from '../icons/DeleteAttachmentIcon';
import { IconButton } from '../ui/IconButton/IconButton';
import './_filePreviewModal.scss';

type FilePreviewModalProps = {
	file: PreviewFile;
	onClose: () => void;
};

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
	const [textContent, setTextContent] = useState('');

	const isImage = file.type.startsWith('image/');
	const isPdf = file.type === 'application/pdf';
	const isText = isTextPreview(file);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};

		document.addEventListener('keydown', handleKeyDown);

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [onClose]);

	useEffect(() => {
		if (!isText) {
			setTextContent('');
			return;
		}

		fetch(file.url)
			.then((response) => response.text())
			.then(setTextContent)
			.catch(() => {
				setTextContent('Не удалось прочитать файл.');
			});
	}, [file.url, isText]);

	const renderFilePreview = () => {
		if (isPdf) {
			return <iframe className="file-preview__frame" src={file.url} title={file.name} />;
		}

		if (isText) {
			return <pre className="file-preview__text">{textContent}</pre>;
		}

		return <div className="file-preview__empty">Этот тип файла нельзя показать прямо в браузере</div>;
	};

	return (
		<div className="file-preview" onClick={onClose}>
			{isImage ? (
				<>
					<div className="file-preview__image-header">
						<div className="file-preview__name">{file.name}</div>

						<IconButton className="file-preview__close" onClick={onClose} aria-label="Закрыть превью">
							<DeleteAttachmentIcon />
						</IconButton>
					</div>
					<div
						className="file-preview__image-container"
						role="dialog"
						aria-modal="true"
						onClick={(event) => event.stopPropagation()}
					>
						<img className="file-preview__image" src={file.url} alt={file.name} />
					</div>
				</>
			) : (
				<>
					<div className="file-preview__file-header">
						<div className="file-preview__name">{file.name}</div>

						<IconButton className="file-preview__close" onClick={onClose} aria-label="Закрыть превью">
							<DeleteAttachmentIcon />
						</IconButton>
					</div>
					<div
						className="file-preview__file-container"
						role="dialog"
						aria-modal="true"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="file-preview__body">{renderFilePreview()}</div>
					</div>
				</>
			)}
		</div>
	);
}
