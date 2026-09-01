import { lazy, Suspense, useMemo } from 'react';
import { createStore, useStore } from 'zustand';

const MarkdownPreview = lazy(() => import('../MessageBubble/AssistantMessageContent'));

type MarkdownEditorProps = {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	readonly?: boolean;
};

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
}: MarkdownEditorProps) {
	const store = useMemo(() => createMarkdownEditorUiStore(readonly), [readonly]);
	const preview = useStore(store, (state) => state.preview);
	const setPreview = useStore(store, (state) => state.setPreview);
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
						<MarkdownPreview content={value} isStreaming={false} />
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
