// utils/files.ts
import type { ChatAttachment, PreviewFile } from '../types/chat';


export function createChatAttachment(file: File): ChatAttachment {
  // application/octet-stream - тип файла, который означает «просто бинарный файл»
	const type = file.type || 'application/octet-stream';

	return {
		id: crypto.randomUUID(),
		name: file.name,
		size: file.size,
		type,
		url: URL.createObjectURL(file),
		isImage: type.startsWith('image/'),
	};
}

export function fileToPreviewFile(file: File): PreviewFile {
	const type = file.type || 'application/octet-stream';

	return {
		name: file.name,
		size: file.size,
		type,
		url: URL.createObjectURL(file),
		revokeOnClose: true,
	};
}

export function attachmentToPreviewFile(attachment: ChatAttachment): PreviewFile {
	return {
		name: attachment.name,
		size: attachment.size,
		type: attachment.type,
		url: attachment.url,
		revokeOnClose: false,
	};
}

export function isTextPreview(file: PreviewFile) {
	return file.type.startsWith('text/') || /\.(txt|md|json|csv|log|html|css|scss|sass|less|js|jsx|ts|tsx|xml|yaml|yml|toml|ini|env|py|rb|php|java|kt|kts|swift|go|rs|c|h|cpp|hpp|cs|sql|sh|bash|zsh|vue|svelte)$/i.test(file.name);
}
