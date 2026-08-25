import { lazy, Suspense, useState } from 'react';

const MarkdownPreview = lazy(() => import('../MessageBubble/AssistantMessageContent'));

type MarkdownEditorProps = {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	readonly?: boolean;
};

export default function MarkdownEditor({ value, onChange, label = 'Содержимое', readonly = false }: MarkdownEditorProps) {
	const [preview, setPreview] = useState(readonly);
	return <div className="markdown-editor">
		{!readonly && <div className="markdown-editor__tabs"><button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Редактирование</button><button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Предпросмотр</button></div>}
		{preview
			? <div className="markdown-editor__preview"><Suspense fallback={<span>Загрузка предпросмотра…</span>}><MarkdownPreview content={value} isStreaming={false} /></Suspense></div>
			: <textarea aria-label={label} placeholder="Вставьте текст" value={value} onChange={(event) => onChange(event.target.value)} />}
	</div>;
}
