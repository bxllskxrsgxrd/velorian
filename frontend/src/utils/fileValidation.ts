import { getAttachmentLimits, MAX_ATTACHMENTS } from '../constants/attachmentLimits';
import { getUserFacingError } from '../errors/userErrorMessages';
import type { ChatMessageError } from '../types/chat';

export { MAX_ATTACHMENTS };
export const ACCEPTED_FILE_TYPES =
	'image/png,image/jpeg,image/webp,image/bmp,image/tiff,.pdf,.docx,.txt,.md,.json,.csv,.log,.html,.css,.scss,.sass,.less,.js,.jsx,.ts,.tsx,.xml,.yaml,.yml,.toml,.ini,.env,.py,.rb,.php,.java,.kt,.kts,.swift,.go,.rs,.c,.h,.cpp,.hpp,.cs,.sql,.sh,.bash,.zsh,.vue,.svelte';

const SUPPORTED_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.bmp',
	'.tiff',
	'.tif',
	'.pdf',
	'.docx',
	'.txt',
	'.md',
	'.json',
	'.csv',
	'.log',
	'.html',
	'.css',
	'.scss',
	'.sass',
	'.less',
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.xml',
	'.yaml',
	'.yml',
	'.toml',
	'.ini',
	'.env',
	'.py',
	'.rb',
	'.php',
	'.java',
	'.kt',
	'.kts',
	'.swift',
	'.go',
	'.rs',
	'.c',
	'.h',
	'.cpp',
	'.hpp',
	'.cs',
	'.sql',
	'.sh',
	'.bash',
	'.zsh',
	'.vue',
	'.svelte',
]);

function extensionOf(name: string) {
	const dotIndex = name.lastIndexOf('.');
	return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

export function validateAndMergeFiles(currentFiles: File[], incomingFiles: File[]) {
	const limits = getAttachmentLimits();
	const attachmentCount = currentFiles.length + incomingFiles.length;
	if (attachmentCount > limits.maxAttachments) {
		return {
			files: currentFiles,
			error: getUserFacingError('ATTACHMENT_COUNT_LIMIT_EXCEEDED'),
			diagnostics: { actualAttachments: attachmentCount, maximumAttachments: limits.maxAttachments },
		};
	}

	for (const file of incomingFiles) {
		if (!SUPPORTED_EXTENSIONS.has(extensionOf(file.name))) {
			return {
				files: currentFiles,
				error: getUserFacingError('UNSUPPORTED_FILE_TYPE'),
				diagnostics: { fileName: file.name, extension: extensionOf(file.name) },
			};
		}
		if (file.size > limits.maxFileSize) {
			return {
				files: currentFiles,
				error: getUserFacingError('FILE_SIZE_LIMIT_EXCEEDED'),
				diagnostics: { fileName: file.name, actualSize: file.size, maximumSize: limits.maxFileSize },
			};
		}
	}

	const mergedFiles = [...currentFiles, ...incomingFiles];
	const totalSize = mergedFiles.reduce((sum, file) => sum + file.size, 0);
	if (totalSize > limits.maxTotalSize) {
		return {
			files: currentFiles,
			error: getUserFacingError('ATTACHMENTS_TOTAL_SIZE_LIMIT_EXCEEDED'),
			diagnostics: { actualTotalSize: totalSize, maximumTotalSize: limits.maxTotalSize },
		};
	}
	return { files: mergedFiles, error: undefined as ChatMessageError | undefined, diagnostics: undefined };
}
