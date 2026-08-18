export const MAX_FILES = 10;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_TOTAL_FILE_SIZE = 25 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES = 'image/png,image/jpeg,image/webp,image/bmp,image/tiff,.pdf,.docx,.txt,.md,.json,.csv,.log,.html,.css,.js,.ts,.tsx,.xml';

const SUPPORTED_EXTENSIONS = new Set([
	'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif',
	'.pdf', '.docx', '.txt', '.md', '.json', '.csv', '.log', '.html', '.css', '.js', '.ts', '.tsx', '.xml',
]);

function extensionOf(name: string) {
	const dotIndex = name.lastIndexOf('.');
	return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

export function validateAndMergeFiles(currentFiles: File[], incomingFiles: File[]) {
	if (currentFiles.length + incomingFiles.length > MAX_FILES) {
		return { files: currentFiles, error: `Можно прикрепить не более ${MAX_FILES} файлов` };
	}

	for (const file of incomingFiles) {
		if (!SUPPORTED_EXTENSIONS.has(extensionOf(file.name))) {
			return { files: currentFiles, error: `Формат файла «${file.name}» не поддерживается` };
		}
		if (file.size > MAX_FILE_SIZE) {
			return { files: currentFiles, error: `Файл «${file.name}» превышает 10 МБ` };
		}
	}

	const mergedFiles = [...currentFiles, ...incomingFiles];
	const totalSize = mergedFiles.reduce((sum, file) => sum + file.size, 0);
	if (totalSize > MAX_TOTAL_FILE_SIZE) {
		return { files: currentFiles, error: 'Общий размер файлов превышает 25 МБ' };
	}
	return { files: mergedFiles, error: '' };
}
