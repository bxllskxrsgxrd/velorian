import { lazy, Suspense, useMemo } from 'react';
import { createStore, useStore } from 'zustand';

const MarkdownPreview = lazy(() => import('../MessageBubble/AssistantMessageContent'));

type MarkdownEditorProps = {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	readonly?: boolean;
	fileName?: string;
};

const SOURCE_LANGUAGES: Record<string, string> = {
	'.html': 'markup',
	'.htm': 'markup',
	'.xml': 'xml',
	'.vue': 'vue',
	'.svelte': 'svelte',
	'.css': 'css',
	'.scss': 'scss',
	'.sass': 'sass',
	'.less': 'less',
	'.js': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.jsx': 'jsx',
	'.ts': 'typescript',
	'.tsx': 'tsx',
	'.json': 'json',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.py': 'python',
	'.rb': 'ruby',
	'.php': 'php',
	'.java': 'java',
	'.kt': 'kotlin',
	'.kts': 'kotlin',
	'.swift': 'swift',
	'.go': 'go',
	'.rs': 'rust',
	'.c': 'c',
	'.h': 'c',
	'.cpp': 'cpp',
	'.hpp': 'cpp',
	'.cs': 'csharp',
	'.sql': 'sql',
	'.sh': 'bash',
	'.bash': 'bash',
	'.zsh': 'bash',
};

function sourceLanguage(fileName: string | undefined, content: string) {
	const dotIndex = fileName?.lastIndexOf('') ?? -1;
	const extension = dotIndex >= 0 ? fileName?.slice(dotIndex).toLowerCase() : undefined;
	if (extension && SOURCE_LANGUAGES[extension]) return SOURCE_LANGUAGES[extension];
	return /^(?:\uFEFF?\s*)(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(content) ? 'markup' : undefined;
}

function createMarkdownEditorUiStore(initialPreview: boolean) {
	return createStore<{ preview: boolean; setPreview: (preview: boolean) => void }>((set) => ({
		preview: initialPreview,
		setPreview: (preview) => set({ preview }),
	}));
}

export default function MarkdownEditor({
	value,
	onChange,
	label = 'Содержимое',
	readonly = false,
	fileName,
}: MarkdownEditorProps) {
	const store = useMemo(() => createMarkdownEditorUiStore(readonly), [readonly]);
	const preview = useStore(store, (state) => state.preview);
	const setPreview = useStore(store, (state) => state.setPreview);
	const previewLanguage = readonly ? sourceLanguage(fileName, value) : undefined;
	return (
		<div className="markdown-editor">
			{!readonly && (
				<div className="markdown-editor__tabs">
					<button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
						Редактирование
					</button>
					<button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
						Предпросмотр
					</button>
				</div>
			)}
			{preview ? (
				<div className="markdown-editor__preview">
					<Suspense fallback={<span>Загрузка предпросмотра…</span>}>
						<MarkdownPreview content={value} isStreaming={false} sourceLanguage={previewLanguage} />
					</Suspense>
				</div>
			) : (
				<textarea
					aria-label={label}
					placeholder="Вставьте текст"
					value={value}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</div>
	);
}
