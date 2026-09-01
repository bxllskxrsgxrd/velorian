import { lazy, Suspense, useEffect } from 'react';
import type { PreviewFile } from '../../types/chat';
import { getFileCodeLanguage } from '../../utils/codeLanguage';
import { isTextPreview } from '../../utils/files';
import { reportError } from '../../utils/reportError';
import { DeleteAttachmentIcon } from '../icons/AppIcons';
import { IconButton } from '../ui/IconButton/IconButton';
import './_filePreviewModal.scss';
import { useFilesStore } from '../../stores/filesStore';

const HighlightedCode = lazy(() => import('../MessageBubble/AssistantMessageContent').then((module) => ({ default: module.HighlightedCode })));
const MarkdownPreview = lazy(() => import('../MessageBubble/AssistantMessageContent'));

type FilePreviewModalProps = {
	file: PreviewFile;
	onClose: () => void;
};

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
	const textPreview = useFilesStore((state) => state.textPreview);
	const setTextPreview = useFilesStore((state) => state.setTextPreview);

	const isImage = file.type.startsWith('image/');
	const isPdf = file.type === 'application/pdf';
	const isText = isTextPreview(file);
	const isMarkdown = file.type === 'text/markdown' || file.name.toLowerCase().endsWith('.md');

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
		if (!isText) return;

		const controller = new AbortController();

		fetch(file.url, { signal: controller.signal, credentials: 'include' })
			.then((response) => response.text())
			.then((content) => setTextPreview({ url: file.url, content }))
			.catch((error: unknown) => {
				if (error instanceof DOMException && error.name === 'AbortError') return;

				reportError('Не удалось загрузить превью файла', error, { fileName: file.name });
				setTextPreview({ url: file.url, content: 'Не удалось прочитать файл.' });
			});

		return () => controller.abort();
	}, [file.name, file.url, isText, setTextPreview]);

	const renderFilePreview = () => {
		if (isPdf) {
			return <iframe className="file-preview__frame" src={file.url} title={file.name} />;
		}

		if (isText) {
			const textContent = textPreview?.url === file.url ? textPreview.content : 'Загрузка…';
			if (isMarkdown) {
				return <div className="file-preview__markdown"><Suspense fallback={<pre className="file-preview__text">{textContent}</pre>}><MarkdownPreview content={textContent} isStreaming={false} /></Suspense></div>;
			}

			return (
				<Suspense fallback={<pre className="file-preview__text">{textContent}</pre>}><HighlightedCode
					code={textContent}
					language={getFileCodeLanguage(file.name)}
					className="file-preview__text"
					ariaLabel={`Содержимое файла ${file.name}`}
				/></Suspense>
			);
		}

		return <div className="file-preview__empty">Этот тип файла нельзя показать прямо в браузере</div>;
	};

	return (
		<div className="file-preview" onClick={onClose}>
			{isImage ? (
				<>
					<div className="file-preview__image-header">
						<div className="file-preview__name">{file.name}</div>

						<IconButton
							className="file-preview__close"
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
							aria-label="Закрыть превью"
						>
							<DeleteAttachmentIcon />
						</IconButton>
					</div>
					<div
						className="file-preview__image-container"
						role="dialog"
						aria-modal="true"
						aria-label={`Предпросмотр файла ${file.name}`}
						onClick={(event) => event.stopPropagation()}
					>
						<img className="file-preview__image" src={file.url} alt={file.name} />
					</div>
				</>
			) : (
				<>
					<div className="file-preview__file-header">
						<div className="file-preview__name">{file.name}</div>

						<IconButton
							className="file-preview__close"
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
							aria-label="Закрыть превью"
						>
							<DeleteAttachmentIcon />
						</IconButton>
					</div>
					<div
						className="file-preview__file-container"
						role="dialog"
						aria-modal="true"
						aria-label={`Предпросмотр файла ${file.name}`}
						onClick={(event) => event.stopPropagation()}
					>
						<div className="file-preview__body">{renderFilePreview()}</div>
					</div>
				</>
			)}
		</div>
	);
}
