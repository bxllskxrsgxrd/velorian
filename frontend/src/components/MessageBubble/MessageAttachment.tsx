import type { ChatAttachment } from '../../types/chat';
import { formatFileSize } from '../../utils/formatFileSize';
import { DocumentIcon } from '../icons/DocumentIcon';

export function MessageAttachment({ attachment }: { attachment: ChatAttachment }) {
	if (attachment.isImage && attachment.url) {
		return <img className="message__attachment-image" src={attachment.url} alt={attachment.name} />;
	}

	return (
		<div className="message__attachment-file">
			<DocumentIcon />

			<div className="message__attachment-info">
				<span className="message__attachment-name">{attachment.name}</span>
				<span className="message__attachment-size">{formatFileSize(attachment.size)}</span>
			</div>
		</div>
	);
}
