import type { ChatAttachment } from '../../types/chat';
import { formatFileSize } from '../../utils/formatFileSize';
import { DownloadIcon } from '../icons/AppIcons';
import { DocumentIcon } from '../icons/AppIcons';

type MessageAttachmentProps = {
	attachment: ChatAttachment;
	onOpen?: () => void;
	onAddToKnowledge?: () => void;
	showKnowledgeAction?: boolean;
};

function attachmentFormat(attachment: ChatAttachment) {
	if (attachment.type === 'text/markdown' || attachment.name.toLowerCase().endsWith('.md')) return 'Markdown';
	const extension = attachment.name.split('.').pop();
	return extension && extension !== attachment.name ? extension.toUpperCase() : 'Файл';
}

export function MessageAttachment({ attachment, onOpen, onAddToKnowledge, showKnowledgeAction = true }: MessageAttachmentProps) {
	if (attachment.isImage && attachment.url) {
		return <img className="message__attachment-image" src={attachment.url} alt={attachment.name} />;
	}

	return (
		<div className={`message__attachment-file${attachment.generated ? ' message__attachment-file--generated' : ''}`}>
			<button className="message__attachment-main" type="button" onClick={onOpen}>
				<DocumentIcon size={attachment.generated ? 24 : 16} />
				<span className="message__attachment-info">
					<span className="message__attachment-name">{attachment.name}</span>
					<span className="message__attachment-size">
						{attachment.generated ? `${attachmentFormat(attachment)} · ${formatFileSize(attachment.size)}` : formatFileSize(attachment.size)}
					</span>
				</span>
			</button>
			{showKnowledgeAction && attachment.generated && (attachment.knowledgeSaved
				? <span className="message__attachment-saved">Добавлено</span>
				: onAddToKnowledge && <button className="message__attachment-knowledge" type="button" onClick={onAddToKnowledge}>Добавить в БД</button>)}
			<a className="message__download" href={attachment.downloadUrl ?? attachment.url} download={attachment.name} aria-label={`Скачать ${attachment.name}`} title="Скачать"><DownloadIcon /></a>
		</div>
	);
}
