import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createConversation, createKnowledgeItem, deleteConversation, deleteKnowledgeItem, listConversations, listKnowledge, renameConversation, updateKnowledgeItem, uploadKnowledgeFile } from '../api/chatApi';
import { ChatSidebar } from '../components/ChatSidebar/ChatSidebar';
import { useToast } from '../components/Toast/ToastContext';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Rating } from '../components/ui/Rating/Rating';
import { getStoredAccentTheme, setAccentTheme, type AccentTheme } from '../theme/accentTheme';
import type { AuthUser, ConversationSummary, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';

const MarkdownEditor = lazy(() => import('../components/MarkdownEditor/MarkdownEditor'));

type DialogState = { type: 'view' | 'edit' | 'delete'; item: KnowledgeItem } | { type: 'add' } | null;
type RatingFilter = 'all' | '5' | '4' | '3' | 'unrated';
type SortMode = 'date_desc' | 'date_asc' | 'rating_desc' | 'rating_asc';

function storedCollapsed() {
	try { return window.localStorage.getItem('velorian-sidebar-collapsed') === 'true'; } catch { return false; }
}

export function KnowledgePage({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const [items, setItems] = useState<KnowledgeItem[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [search, setSearch] = useState(params.get('q') ?? '');
	const sourceType = params.get('source') ?? '';
	const activeFilter = params.get('active') ?? 'all';
	const ratingFilter = (params.get('rating') as RatingFilter | null) ?? 'all';
	const sort = (params.get('sort') as SortMode | null) ?? 'date_desc';
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [title, setTitle] = useState('');
	const [content, setContent] = useState('');
	const [rating, setRating] = useState<number | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationSearch, setConversationSearch] = useState('');
	const [accent, setAccent] = useState<AccentTheme>(getStoredAccentTheme);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(storedCollapsed);
	const { showToast } = useToast();

	useEffect(() => {
		listConversations().then(setConversations).catch((error: unknown) => reportError('KNOWLEDGE_SIDEBAR_CHATS_FAILED', error));
	}, []);

	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setLoading(true);
			listKnowledge({
				search: params.get('q') || undefined,
				sourceType: sourceType || undefined,
				isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
				minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter),
				unrated: ratingFilter === 'unrated', sort, limit: 20,
			}).then((result) => {
				if (!cancelled) { setItems(result.items); setNextCursor(result.pageInfo.nextCursor); }
			}).catch((error: unknown) => {
				reportError('KNOWLEDGE_LIST_FAILED', error);
				if (!cancelled) showToast(error instanceof Error ? error.message : 'Не удалось загрузить базу знаний', 'error');
			}).finally(() => { if (!cancelled) setLoading(false); });
		}, 250);
		return () => { cancelled = true; window.clearTimeout(timer); };
	}, [activeFilter, params, ratingFilter, showToast, sort, sourceType]);

	const filteredConversations = useMemo(() => {
		const query = conversationSearch.trim().toLocaleLowerCase('ru');
		return query ? conversations.filter((item) => item.title.toLocaleLowerCase('ru').includes(query)) : conversations;
	}, [conversationSearch, conversations]);
	const counts = useMemo(() => ({ total: items.length, active: items.filter((item) => item.isActive).length }), [items]);

	function setFilter(name: string, value: string, defaultValue = '') {
		const next = new URLSearchParams(params);
		if (value && value !== defaultValue) next.set(name, value); else next.delete(name);
		setParams(next);
	}
	function handleSearchChange(value: string) {
		setSearch(value);
		const next = new URLSearchParams(params);
		if (value.trim()) next.set('q', value.trim()); else next.delete('q');
		setParams(next, { replace: true });
	}
	function openAdd() { setTitle(''); setContent(''); setRating(null); setFile(null); setDialog({ type: 'add' }); }
	function openEdit(item: KnowledgeItem) { setTitle(item.title); setContent(item.content); setRating(item.rating ?? null); setFile(null); setDialog({ type: 'edit', item }); }

	async function saveDialog() {
		try {
			if (dialog?.type === 'add') {
				const created = file ? await uploadKnowledgeFile(file, title, rating ?? undefined) : await createKnowledgeItem(title.trim(), content.trim(), rating ?? undefined);
				setItems((current) => [created, ...current]);
				showToast('Данные добавлены в базу знаний', 'success');
			} else if (dialog?.type === 'edit') {
				const updated = await updateKnowledgeItem(dialog.item.id, { title: title.trim(), content: content.trim(), rating });
				setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
				showToast('Изменения сохранены', 'success');
			}
			setDialog(null);
		} catch (error) {
			reportError('KNOWLEDGE_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить данные', 'error');
		}
	}

	async function changeRating(item: KnowledgeItem, value: number | null) {
		const previous = item.rating;
		setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, rating: value } : entry));
		try {
			const updated = await updateKnowledgeItem(item.id, { rating: value });
			setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
		} catch (error) {
			setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, rating: previous } : entry));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить рейтинг', 'error');
		}
	}

	async function toggleItem(item: KnowledgeItem) {
		setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isActive: !item.isActive } : entry));
		try { const updated = await updateKnowledgeItem(item.id, { isActive: !item.isActive }); setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry)); }
		catch (error) { setItems((current) => current.map((entry) => entry.id === item.id ? item : entry)); showToast(error instanceof Error ? error.message : 'Не удалось изменить состояние', 'error'); }
	}

	async function removeItem(item: KnowledgeItem) {
		try { await deleteKnowledgeItem(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)); setDialog(null); showToast('Элемент удалён', 'success'); }
		catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось удалить элемент', 'error'); }
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const result = await listKnowledge({ search: params.get('q') || undefined, sourceType: sourceType || undefined, isActive: activeFilter === 'all' ? undefined : activeFilter === 'active', minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter), unrated: ratingFilter === 'unrated', sort, limit: 20, cursor: nextCursor });
			setItems((current) => [...current, ...result.items]); setNextCursor(result.pageInfo.nextCursor);
		} catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось загрузить следующую страницу', 'error'); }
		finally { setLoadingMore(false); }
	}

	return <div className="knowledge-shell">
		<ChatSidebar user={user} conversations={filteredConversations} activeConversationId={null} search={conversationSearch} accentTheme={accent} isOpen={sidebarOpen} isCollapsed={sidebarCollapsed} activeSection="knowledge"
			onSearchChange={setConversationSearch} onSelect={(id) => navigate(`/?conversation=${encodeURIComponent(id)}`)}
			onNew={() => void createConversation().then((created) => navigate(`/?conversation=${encodeURIComponent(created.id)}`)).catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Не удалось создать чат', 'error'))}
			onDelete={(id) => void deleteConversation(id).then(() => setConversations((current) => current.filter((item) => item.id !== id)))}
			onRename={(conversation, nextTitle) => void renameConversation(conversation.id, nextTitle).then((updated) => setConversations((current) => current.map((item) => item.id === updated.id ? updated : item)))}
			onAccentChange={(theme) => { setAccent(theme); setAccentTheme(theme); }} onExport={() => showToast('Откройте чат для экспорта', 'info')} onLogout={() => void onLogout()} onOpenKnowledge={() => undefined}
			onClose={() => setSidebarOpen(false)} onToggleCollapsed={() => setSidebarCollapsed((current) => { const next = !current; try { window.localStorage.setItem('velorian-sidebar-collapsed', String(next)); } catch { /* Storage is optional. */ } return next; })} />
		<main className="knowledge-page">
			<header><div><button className="knowledge-page__mobile-menu" type="button" onClick={() => setSidebarOpen(true)}>☰</button><h1>База знаний</h1><p>{user.email} · на странице активно {counts.active} из {counts.total}</p></div><button className="knowledge-page__add" type="button" onClick={openAdd}>Добавить данные</button></header>
			<section className="knowledge-page__filters" aria-label="Фильтры базы знаний">
				<input value={search} onChange={(event) => handleSearchChange(event.target.value)} placeholder="Поиск по названию и содержимому" aria-label="Поиск по базе знаний" />
				<select value={sourceType} onChange={(event) => setFilter('source', event.target.value)} aria-label="Источник"><option value="">Все источники</option><option value="manual">Вручную</option><option value="uploaded_file">Файлы</option><option value="rated_content">Оценённые ответы</option></select>
				<select value={ratingFilter} onChange={(event) => setFilter('rating', event.target.value, 'all')} aria-label="Рейтинг"><option value="all">Все рейтинги</option><option value="5">5 ★</option><option value="4">4 ★ и выше</option><option value="3">3 ★ и выше</option><option value="unrated">Без рейтинга</option></select>
				<select value={sort} onChange={(event) => setFilter('sort', event.target.value, 'date_desc')} aria-label="Сортировка"><option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option><option value="rating_desc">Рейтинг: высокий</option><option value="rating_asc">Рейтинг: низкий</option></select>
				<select value={activeFilter} onChange={(event) => setFilter('active', event.target.value, 'all')} aria-label="Использование"><option value="all">Все состояния</option><option value="active">Используются агентом</option><option value="inactive">Отключены</option></select>
			</section>
			<section className="knowledge-page__list">
				{loading && <p className="knowledge-page__empty">Загрузка…</p>}
				{!loading && items.length === 0 && <p className="knowledge-page__empty">Сохранённых данных пока нет</p>}
				{!loading && items.map((item) => <article className="knowledge-card" key={item.id}>
					<div className="knowledge-card__head"><div><strong>{item.title}</strong><Rating value={item.rating} readonly label={`Рейтинг ${item.title}`} /><span>{item.sourceType === 'rated_content' ? 'Ответ агента' : item.sourceType === 'uploaded_file' ? 'Файл' : 'Добавлено вручную'} · {new Date(item.createdAt).toLocaleDateString('ru-RU')}</span></div><label><input type="checkbox" checked={item.isActive} onChange={() => void toggleItem(item)} />Использовать</label></div>
					<p>{item.content || 'Текстовое содержимое не извлечено'}</p>
					<div className="knowledge-card__actions"><button type="button" onClick={() => setDialog({ type: 'view', item })}>Открыть</button><button type="button" onClick={() => openEdit(item)}>Редактировать</button>{item.downloadUrl && <a href={item.downloadUrl} download>Скачать</a>}<button type="button" onClick={() => void changeRating(item, null)}>Убрать рейтинг</button><button className="knowledge-card__delete" type="button" onClick={() => setDialog({ type: 'delete', item })}>Удалить</button></div>
				</article>)}
				{!loading && nextCursor && <button className="knowledge-page__more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Загрузка…' : 'Показать ещё'}</button>}
			</section>

			{dialog?.type === 'add' && <ModalDialog title="Добавить данные" confirmLabel="Добавить" onClose={() => setDialog(null)} onConfirm={() => void saveDialog()}><div className="knowledge-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" aria-label="Название" /><Suspense fallback={<div>Загрузка редактора…</div>}><MarkdownEditor value={content} onChange={setContent} /></Suspense><span>или загрузите файл</span><input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><label>Рейтинг (необязательно)<Rating value={rating} onChange={setRating} label="Рейтинг элемента" /></label></div></ModalDialog>}
			{dialog?.type === 'edit' && <ModalDialog title="Редактировать данные" confirmLabel="Сохранить" onClose={() => setDialog(null)} onConfirm={() => void saveDialog()}><div className="knowledge-form"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Название" /><Suspense fallback={<div>Загрузка редактора…</div>}><MarkdownEditor value={content} onChange={setContent} /></Suspense><label>Рейтинг<Rating value={rating} onChange={setRating} label="Рейтинг элемента" /></label></div></ModalDialog>}
			{dialog?.type === 'view' && <ModalDialog title={dialog.item.title} confirmLabel="Закрыть" onClose={() => setDialog(null)} onConfirm={() => setDialog(null)}><Rating value={dialog.item.rating} readonly /><div className="knowledge-view"><Suspense fallback={<span>Загрузка предпросмотра…</span>}><MarkdownEditor value={dialog.item.content} onChange={() => undefined} readonly /></Suspense></div></ModalDialog>}
			{dialog?.type === 'delete' && <ModalDialog title="Удалить элемент?" confirmLabel="Удалить" danger onClose={() => setDialog(null)} onConfirm={() => void removeItem(dialog.item)}><p>«{dialog.item.title}» будет удалён из базы знаний.</p></ModalDialog>}
		</main>
		{sidebarOpen && <button className="chat-shell__backdrop" type="button" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню" />}
	</div>;
}

export default KnowledgePage;
