import { useEffect, useMemo, useState } from 'react';
import { createKnowledgeItem, deleteKnowledgeItem, listKnowledge, updateKnowledgeItem, uploadKnowledgeFile } from '../api/chatApi';
import { useToast } from '../components/Toast/ToastContext';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import type { AuthUser, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';

type DialogState = { type: 'view' | 'edit' | 'delete'; item: KnowledgeItem } | { type: 'add' } | null;

export function KnowledgePage({ user, onBack }: { user: AuthUser; onBack: () => void }) {
	const [items, setItems] = useState<KnowledgeItem[]>([]);
	const [search, setSearch] = useState('');
	const [sourceType, setSourceType] = useState('');
	const [activeFilter, setActiveFilter] = useState('all');
	const [loading, setLoading] = useState(true);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [title, setTitle] = useState('');
	const [content, setContent] = useState('');
	const [file, setFile] = useState<File | null>(null);
	const { showToast } = useToast();

	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setLoading(true);
			listKnowledge({ search, sourceType: sourceType || undefined, isActive: activeFilter === 'all' ? undefined : activeFilter === 'active' })
				.then((result) => { if (!cancelled) setItems(result); })
				.catch((error: unknown) => { reportError('KNOWLEDGE_LIST_FAILED', error); if (!cancelled) showToast(error instanceof Error ? error.message : 'Не удалось загрузить базу знаний', 'error'); })
				.finally(() => { if (!cancelled) setLoading(false); });
		}, 250);
		return () => { cancelled = true; window.clearTimeout(timer); };
	}, [activeFilter, search, showToast, sourceType]);

	const counts = useMemo(() => ({ total: items.length, active: items.filter((item) => item.isActive).length }), [items]);

	function openAdd() { setTitle(''); setContent(''); setFile(null); setDialog({ type: 'add' }); }
	function openEdit(item: KnowledgeItem) { setTitle(item.title); setContent(item.content); setFile(null); setDialog({ type: 'edit', item }); }

	async function saveDialog() {
		try {
			if (dialog?.type === 'add') {
				const created = file ? await uploadKnowledgeFile(file, title) : await createKnowledgeItem(title.trim(), content.trim());
				setItems((current) => [created, ...current]);
				showToast('Данные добавлены в базу знаний', 'success');
			} else if (dialog?.type === 'edit') {
				const updated = await updateKnowledgeItem(dialog.item.id, { title: title.trim(), content: content.trim() });
				setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
				showToast('Изменения сохранены', 'success');
			}
			setDialog(null);
		} catch (error) {
			reportError('KNOWLEDGE_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить данные', 'error');
		}
	}

	async function toggleItem(item: KnowledgeItem) {
		setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isActive: !item.isActive } : entry));
		try {
			const updated = await updateKnowledgeItem(item.id, { isActive: !item.isActive });
			setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
		} catch (error) {
			setItems((current) => current.map((entry) => entry.id === item.id ? item : entry));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить состояние', 'error');
		}
	}

	async function removeItem(item: KnowledgeItem) {
		try {
			await deleteKnowledgeItem(item.id);
			setItems((current) => current.filter((entry) => entry.id !== item.id));
			setDialog(null);
			showToast('Элемент удалён', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось удалить элемент', 'error');
		}
	}

	return (
		<main className="knowledge-page">
			<header><div><button type="button" onClick={onBack}>← К чатам</button><h1>База знаний</h1><p>{user.email} · активно {counts.active} из {counts.total}</p></div><button className="knowledge-page__add" type="button" onClick={openAdd}>Добавить данные</button></header>
			<section className="knowledge-page__filters" aria-label="Фильтры базы знаний">
				<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию и содержимому" />
				<select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">Все источники</option><option value="manual">Вручную</option><option value="uploaded_file">Файлы</option><option value="rated_content">Оценённые ответы</option></select>
				<select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}><option value="all">Все состояния</option><option value="active">Используются агентом</option><option value="inactive">Отключены</option></select>
			</section>
			<section className="knowledge-page__list">
				{loading && <p className="knowledge-page__empty">Загрузка…</p>}
				{!loading && items.length === 0 && <p className="knowledge-page__empty">Сохранённых данных пока нет</p>}
				{!loading && items.map((item) => (
					<article className="knowledge-card" key={item.id}>
						<div className="knowledge-card__head"><div><strong>{item.title}</strong><span>{item.sourceType === 'rated_content' ? 'Ответ агента' : item.sourceType === 'uploaded_file' ? 'Файл' : 'Добавлено вручную'} · {new Date(item.createdAt).toLocaleDateString('ru-RU')}{item.rating ? ` · оценка ${item.rating}/5` : ''}</span></div><label><input type="checkbox" checked={item.isActive} onChange={() => void toggleItem(item)} />Использовать</label></div>
						<p>{item.content || 'Текстовое содержимое не извлечено'}</p>
						<div className="knowledge-card__actions"><button type="button" onClick={() => setDialog({ type: 'view', item })}>Открыть</button><button type="button" onClick={() => openEdit(item)}>Редактировать</button>{item.downloadUrl && <a href={item.downloadUrl} download>Скачать</a>}<button className="knowledge-card__delete" type="button" onClick={() => setDialog({ type: 'delete', item })}>Удалить</button></div>
					</article>
				))}
			</section>

			{dialog?.type === 'add' && <ModalDialog title="Добавить данные" confirmLabel="Добавить" onClose={() => setDialog(null)} onConfirm={() => void saveDialog()}><div className="knowledge-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" /><textarea value={content} disabled={Boolean(file)} onChange={(event) => setContent(event.target.value)} placeholder="Вставьте текст" /><span>или загрузите файл</span><input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div></ModalDialog>}
			{dialog?.type === 'edit' && <ModalDialog title="Редактировать данные" confirmLabel="Сохранить" onClose={() => setDialog(null)} onConfirm={() => void saveDialog()}><div className="knowledge-form"><input value={title} onChange={(event) => setTitle(event.target.value)} /><textarea value={content} onChange={(event) => setContent(event.target.value)} /></div></ModalDialog>}
			{dialog?.type === 'view' && <ModalDialog title={dialog.item.title} confirmLabel="Закрыть" onClose={() => setDialog(null)} onConfirm={() => setDialog(null)}><pre className="knowledge-view">{dialog.item.content || 'Содержимое отсутствует'}</pre></ModalDialog>}
			{dialog?.type === 'delete' && <ModalDialog title="Удалить элемент?" confirmLabel="Удалить" danger onClose={() => setDialog(null)} onConfirm={() => void removeItem(dialog.item)}><p>«{dialog.item.title}» будет удалён из базы знаний.</p></ModalDialog>}
		</main>
	);
}
