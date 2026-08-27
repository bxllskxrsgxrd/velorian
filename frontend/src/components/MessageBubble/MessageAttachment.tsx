import type { ChatAttachment } from '../../types/chat';
import { formatFileSize } from '../../utils/formatFileSize';
import { DownloadIcon } from '../icons/AppIcons';
import { DocumentIcon } from '../icons/AppIcons';

type MessageAttachmentProps = {
	attachment: ChatAttachment;
	onOpen?: () => void;
};

export function MessageAttachment({ attachment, onOpen }: MessageAttachmentProps) {
	if (attachment.isImage && attachment.url) {
		return <img className="message__attachment-image" src={attachment.url} alt={attachment.name} />;
	}

	return (
		<div className="message__attachment-file">
			<button className="message__attachment-main" type="button" onClick={onOpen}>
				<DocumentIcon />
				<span className="message__attachment-info">
					<span className="message__attachment-name">{attachment.name}</span>
					<span className="message__attachment-size">{attachment.generated ? 'Документ' : formatFileSize(attachment.size)}</span>
				</span>
			</button>
			<a className="message__download" href={attachment.downloadUrl ?? attachment.url} download={attachment.name} aria-label={`Скачать ${attachment.name}`} title="Скачать"><DownloadIcon /></a>
		</div>
	);
}
