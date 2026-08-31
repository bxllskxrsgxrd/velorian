import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createKnowledgeApproach, createKnowledgeItem, deleteConversation, deleteKnowledgeItem, listConversations, listKnowledge, listKnowledgeApproaches, renameConversation, updateKnowledgeItem, uploadKnowledgeFile } from '../api/chatApi';
import { ChatSidebar } from '../components/ChatSidebar/ChatSidebar';
import { useToast } from '../components/Toast/ToastContext';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Rating } from '../components/ui/Rating/Rating';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { KnowledgeFilterFields } from '../components/KnowledgeFilterFields/KnowledgeFilterFields';
import { EMPTY_KNOWLEDGE_FILTERS } from '../constants/knowledgeFilters';
import { getStoredAccentTheme, setAccentTheme, type AccentTheme } from '../theme/accentTheme';
import type { AuthUser, ConversationSummary, KnowledgeApproach, KnowledgeFilters, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';

const MarkdownEditor = lazy(() => import('../components/MarkdownEditor/MarkdownEditor'));

type DialogState = { type: 'view' | 'edit' | 'delete'; item: KnowledgeItem } | { type: 'add' } | null;
type RatingFilter = 'all' | '5' | '4' | '3' | 'unrated';
type SortMode = 'date_desc' | 'date_asc' | 'rating_desc' | 'rating_asc';

function storedCollapsed() {
	try { return window.localStorage.getItem('velorian-sidebar-collapsed') === 'true'; } catch { return false; }
}

function extractionStatusLabel(item: KnowledgeItem) {
	if (item.sourceType !== 'uploaded_file') return null;
	const status = item.metadata.extractionStatus;
	if (status === 'empty') return 'Файл не содержит извлекаемого текста';
	if (status === 'ocr_unavailable') return 'Текст изображения не извлечён: OCR недоступен';
	if (status === 'unsupported') return 'Извлечение текста для формата не поддерживается';
	return null;
}

function storedFilters(item: KnowledgeItem): KnowledgeFilters {
	return item.filters ?? {
		geo: typeof item.metadata?.geo === 'string' ? item.metadata.geo : null,
		celebrity: typeof item.metadata?.celebrity === 'string' ? item.metadata.celebrity : null,
		offer: typeof item.metadata?.offer === 'string' ? item.metadata.offer : null,
		news_source: typeof item.metadata?.news_source === 'string' ? item.metadata.news_source : null,
	};
}

export function KnowledgePage({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const [items, setItems] = useState<KnowledgeItem[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [search, setSearch] = useState(params.get('q') ?? '');
	const sourceType = params.get('source') ?? '';
	const approachId = params.get('approach') ?? '';
	const geo = params.get('geo') ?? '';
	const celebrity = params.get('celebrity') ?? '';
	const offer = params.get('offer') ?? '';
	const newsSource = params.get('news_source') ?? '';
	const activeFilter = params.get('active') ?? 'all';
	const ratingFilter = (params.get('rating') as RatingFilter | null) ?? 'all';
	const sort = (params.get('sort') as SortMode | null) ?? 'date_desc';
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [title, setTitle] = useState('');
	const [content, setContent] = useState('');
	const [rating, setRating] = useState<number | null>(null);
	const [isActive, setIsActive] = useState(true);
	const [selectedApproachId, setSelectedApproachId] = useState('');
	const [formFilters, setFormFilters] = useState<KnowledgeFilters>({ ...EMPTY_KNOWLEDGE_FILTERS });
	const [saving, setSaving] = useState(false);
	const [approaches, setApproaches] = useState<KnowledgeApproach[]>([]);
	const [newApproachName, setNewApproachName] = useState('');
	const [showApproachCreator, setShowApproachCreator] = useState(false);
	const [creatingApproach, setCreatingApproach] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationSearch, setConversationSearch] = useState('');
	const [accent, setAccent] = useState<AccentTheme>(getStoredAccentTheme);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(storedCollapsed);
	const { showToast } = useToast();

	useEffect(() => {
		listConversations().then(setConversations).catch((error: unknown) => reportError('KNOWLEDGE_SIDEBAR_CHATS_FAILED', error));
		listKnowledgeApproaches().then(setApproaches).catch((error: unknown) => {
			reportError('KNOWLEDGE_APPROACHES_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось загрузить подходы', 'error');
		});
	}, [showToast]);

	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setLoading(true);
			listKnowledge({
				search: params.get('q') || undefined,
				sourceType: sourceType || undefined,
				approachId: approachId || undefined,
				filters: { geo, celebrity, offer, news_source: newsSource },
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
	}, [activeFilter, approachId, celebrity, geo, newsSource, offer, params, ratingFilter, showToast, sort, sourceType]);

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
	function resetApproachCreator() { setNewApproachName(''); setShowApproachCreator(false); }
	function openAdd() { setTitle(''); setContent(''); setRating(null); setIsActive(true); setSelectedApproachId(''); setFormFilters({ ...EMPTY_KNOWLEDGE_FILTERS }); setFile(null); setSaving(false); resetApproachCreator(); setDialog({ type: 'add' }); }
	function openEdit(item: KnowledgeItem) { setTitle(item.title); setContent(item.content); setRating(item.rating); setIsActive(item.isActive); setSelectedApproachId(item.approach?.id ?? ''); setFormFilters(storedFilters(item)); setFile(null); setSaving(false); resetApproachCreator(); setDialog({ type: 'edit', item }); }
	function resetFilters() { setSearch(''); setParams({}, { replace: true }); }
	const hasActiveFilters = Boolean(search.trim() || sourceType || approachId || geo || celebrity || offer || newsSource || activeFilter !== 'all' || ratingFilter !== 'all' || sort !== 'date_desc');

	async function addApproach() {
		const name = newApproachName.trim();
		if (!name || creatingApproach) return;
		setCreatingApproach(true);
		try {
			const created = await createKnowledgeApproach(name);
			setApproaches((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name, 'ru')));
			setSelectedApproachId(created.id);
			resetApproachCreator();
			showToast('Подход создан', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось создать подход', 'error');
		} finally { setCreatingApproach(false); }
	}
	function markPending(id: string, pending: boolean) {
		setPendingItemIds((current) => {
			const next = new Set(current);
			if (pending) next.add(id); else next.delete(id);
			return next;
		});
	}

	async function saveDialog() {
		if (saving) return;
		setSaving(true);
		try {
			if (dialog?.type === 'add') {
				const created = file ? await uploadKnowledgeFile(file, title, rating, isActive, selectedApproachId || null, formFilters) : await createKnowledgeItem(title.trim(), content, rating, isActive, selectedApproachId || null, formFilters);
				setItems((current) => [created, ...current]);
				showToast('Данные добавлены в базу знаний', 'success');
			} else if (dialog?.type === 'edit') {
				const updated = await updateKnowledgeItem(dialog.item.id, { title: title.trim(), content, rating, isActive, approachId: selectedApproachId || null, filters: formFilters });
				setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
				showToast('Изменения сохранены', 'success');
			}
			setDialog(null);
		} catch (error) {
			reportError('KNOWLEDGE_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить данные', 'error');
		} finally { setSaving(false); }
	}

	async function changeRating(item: KnowledgeItem, value: number | null) {
		if (pendingItemIds.has(item.id)) return;
		const previous = item.rating;
		markPending(item.id, true);
		setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, rating: value } : entry));
		try {
			const updated = await updateKnowledgeItem(item.id, { rating: value });
			setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
		} catch (error) {
			setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, rating: previous } : entry));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить рейтинг', 'error');
		} finally { markPending(item.id, false); }
	}

	async function toggleItem(item: KnowledgeItem, nextActive: boolean) {
		if (pendingItemIds.has(item.id)) return;
		markPending(item.id, true);
		setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isActive: nextActive } : entry));
		try { const updated = await updateKnowledgeItem(item.id, { isActive: nextActive }); setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry)); }
		catch (error) { setItems((current) => current.map((entry) => entry.id === item.id ? item : entry)); showToast(error instanceof Error ? error.message : 'Не удалось изменить состояние', 'error'); }
		finally { markPending(item.id, false); }
	}

	async function removeItem(item: KnowledgeItem) {
		try { await deleteKnowledgeItem(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)); setDialog(null); showToast('Элемент удалён', 'success'); }
		catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось удалить элемент', 'error'); }
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const result = await listKnowledge({ search: params.get('q') || undefined, sourceType: sourceType || undefined, approachId: approachId || undefined, filters: { geo, celebrity, offer, news_source: newsSource }, isActive: activeFilter === 'all' ? undefined : activeFilter === 'active', minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter), unrated: ratingFilter === 'unrated', sort, limit: 20, cursor: nextCursor });
			setItems((current) => [...current, ...result.items]); setNextCursor(result.pageInfo.nextCursor);
		} catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось загрузить следующую страницу', 'error'); }
		finally { setLoadingMore(false); }
	}
	const approachField = <div className="knowledge-form__approach">
		<label>Подход
			<select value={selectedApproachId} onChange={(event) => setSelectedApproachId(event.target.value)} aria-label="Подход элемента">
				<option value="">Без подхода</option>
				{approaches.map((approach) => <option key={approach.id} value={approach.id}>{approach.name}</option>)}
			</select>
		</label>
		{showApproachCreator ? <div className="knowledge-form__approach-create">
			<input value={newApproachName} onChange={(event) => setNewApproachName(event.target.value)} placeholder="Название нового подхода" aria-label="Название нового подхода" maxLength={80} />
			<button type="button" disabled={!newApproachName.trim() || creatingApproach} onClick={() => void addApproach()}>{creatingApproach ? 'Создание…' : 'Создать'}</button>
			<button type="button" onClick={resetApproachCreator}>Отмена</button>
		</div> : <button className="knowledge-form__new-approach" type="button" onClick={() => setShowApproachCreator(true)}>Создать новый подход</button>}
	</div>;
	const filterFields = <KnowledgeFilterFields value={formFilters} onChange={setFormFilters} disabled={saving} />;

	return <div className="knowledge-shell">
		<ChatSidebar user={user} conversations={filteredConversations} activeConversationId={null} search={conversationSearch} accentTheme={accent} isOpen={sidebarOpen} isCollapsed={sidebarCollapsed} activeSection="knowledge"
			onSearchChange={setConversationSearch} onSelect={(id) => navigate(`/chat/${encodeURIComponent(id)}`)}
			onNew={() => navigate('/chat/new')}
			onDelete={(id) => void deleteConversation(id).then(() => setConversations((current) => current.filter((item) => item.id !== id)))}
			onRename={(conversation, nextTitle) => void renameConversation(conversation.id, nextTitle).then((updated) => setConversations((current) => current.map((item) => item.id === updated.id ? updated : item)))}
			onAccentChange={(theme) => { setAccent(theme); setAccentTheme(theme); }} onExport={() => showToast('Откройте чат для экспорта', 'info')} onLogout={() => void onLogout()} onOpenKnowledge={() => undefined}
			onClose={() => setSidebarOpen(false)} onToggleCollapsed={() => setSidebarCollapsed((current) => { const next = !current; try { window.localStorage.setItem('velorian-sidebar-collapsed', String(next)); } catch { /* Storage is optional. */ } return next; })} />
		<main className="knowledge-page">
			<header><div><button className="knowledge-page__mobile-menu" type="button" onClick={() => setSidebarOpen(true)}>☰</button><h1>База знаний</h1><p>{user.email} · на странице активно {counts.active} из {counts.total}</p></div><button className="knowledge-page__add" type="button" onClick={openAdd}>Добавить данные</button></header>
			<section className="knowledge-page__filters" aria-label="Фильтры базы знаний">
				<input value={search} onChange={(event) => handleSearchChange(event.target.value)} placeholder="Поиск по названию, содержимому и имени файла" aria-label="Поиск по базе знаний" />
				<select value={sourceType} onChange={(event) => setFilter('source', event.target.value)} aria-label="Источник"><option value="">Все источники</option><option value="manual">Вручную</option><option value="uploaded_file">Файлы</option><option value="rated_content">Оценённые ответы</option></select>
				<select value={approachId} onChange={(event) => setFilter('approach', event.target.value)} aria-label="Подход"><option value="">Все подходы</option>{approaches.map((approach) => <option key={approach.id} value={approach.id}>{approach.name}</option>)}</select>
				<input value={geo} onChange={(event) => setFilter('geo', event.target.value)} placeholder="ГЕО" aria-label="ГЕО" />
				<input value={celebrity} onChange={(event) => setFilter('celebrity', event.target.value)} placeholder="Селеба" aria-label="Селеба" />
				<input value={offer} onChange={(event) => setFilter('offer', event.target.value)} placeholder="Оффер" aria-label="Оффер" />
				<input value={newsSource} onChange={(event) => setFilter('news_source', event.target.value)} placeholder="Новостник" aria-label="Новостник" />
				<select value={ratingFilter} onChange={(event) => setFilter('rating', event.target.value, 'all')} aria-label="Рейтинг"><option value="all">Все рейтинги</option><option value="5">5 из 5</option><option value="4">4 и выше</option><option value="3">3 и выше</option><option value="unrated">Без рейтинга</option></select>
				<select value={sort} onChange={(event) => setFilter('sort', event.target.value, 'date_desc')} aria-label="Сортировка"><option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option><option value="rating_desc">Рейтинг: высокий</option><option value="rating_asc">Рейтинг: низкий</option></select>
				<select value={activeFilter} onChange={(event) => setFilter('active', event.target.value, 'all')} aria-label="Использование"><option value="all">Все состояния</option><option value="active">Используются агентом</option><option value="inactive">Отключены</option></select>
				<button className="knowledge-page__reset" type="button" disabled={!hasActiveFilters} onClick={resetFilters}>Сбросить</button>
			</section>
			<section className="knowledge-page__list">
				{loading && <p className="knowledge-page__empty">Загрузка…</p>}
				{!loading && items.length === 0 && <p className="knowledge-page__empty">Сохранённых данных пока нет</p>}
				{!loading && items.map((item) => <article className="knowledge-card" key={item.id}>
					<div className="knowledge-card__head"><div><strong>{item.fileName || `${item.title}.md`}</strong><Rating value={item.rating} readonly size="small" showValue ariaLabel={`Рейтинг ${item.title}`} />{item.approach && <span className="knowledge-card__approach">Подход: {item.approach.name}</span>}<div className="knowledge-card__metadata">{Object.entries(storedFilters(item)).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => <span key={key}>{({ geo: 'ГЕО', celebrity: 'Селеба', offer: 'Оффер', news_source: 'Новостник' } as Record<string, string>)[key]}: {value}</span>)}</div><span>{item.sourceType === 'rated_content' ? 'Ответ агента' : item.sourceType === 'assistant_file' ? 'Файл из диалога' : item.sourceType === 'uploaded_file' ? 'Файл' : 'Добавлено вручную'} · {new Date(item.createdAt).toLocaleDateString('ru-RU')}</span>{extractionStatusLabel(item) && <span className="knowledge-card__extraction-warning">{extractionStatusLabel(item)}</span>}</div><Checkbox checked={item.isActive} disabled={pendingItemIds.has(item.id)} onChange={(checked) => void toggleItem(item, checked)} label="Использовать" /></div>
					<p>{item.content || 'Текстовое содержимое не извлечено'}</p>
					<div className="knowledge-card__actions"><button type="button" onClick={() => setDialog({ type: 'view', item })}>Открыть</button><button type="button" onClick={() => openEdit(item)}>Редактировать</button>{item.downloadUrl && <a href={item.downloadUrl} download={item.fileName}>Скачать .md</a>}{item.originalDownloadUrl && <a href={item.originalDownloadUrl} download={item.originalFilename ?? undefined}>Оригинал</a>}<button type="button" onClick={() => void changeRating(item, null)}>Убрать рейтинг</button><button className="knowledge-card__delete" type="button" onClick={() => setDialog({ type: 'delete', item })}>Удалить</button></div>
				</article>)}
				{!loading && nextCursor && <button className="knowledge-page__more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Загрузка…' : 'Показать ещё'}</button>}
			</section>

			{dialog?.type === 'add' && <ModalDialog title="Добавить данные" confirmLabel={saving ? 'Добавление…' : 'Добавить'} confirmDisabled={saving} onClose={() => setDialog(null)} onConfirm={() => void saveDialog()}><div className="knowledge-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" aria-label="Название" /><Suspense fallback={<div>Загрузка редактора…</div>}><MarkdownEditor value={content} onChange={setContent} /></Suspense><span>или загрузите файл</span><input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />{filterFields}{approachField}<label>Рейтинг (необязательно)<Rating value={rating} onChange={setRating} ariaLabel="Рейтинг элемента" /></label><Checkbox checked={isActive} onChange={setIsActive} label="Использовать" /></div></ModalDialog>}
			{dialog?.type === 'edit' && <ModalDialog title="Редактировать данные" confirmLabel={saving ? 'Сохранение…' : 'Сохранить'} confirmDisabled={saving} onClose={() => setDialog(null)} onConfirm={() => void saveDialog()}><div className="knowledge-form"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Название" /><Suspense fallback={<div>Загрузка редактора…</div>}><MarkdownEditor value={content} onChange={setContent} /></Suspense>{filterFields}{approachField}<label>Рейтинг<Rating value={rating} onChange={setRating} ariaLabel="Рейтинг элемента" /></label><Checkbox checked={isActive} onChange={setIsActive} label="Использовать" /></div></ModalDialog>}
			{dialog?.type === 'view' && <ModalDialog title={dialog.item.fileName || `${dialog.item.title}.md`} confirmLabel="Закрыть" onClose={() => setDialog(null)} onConfirm={() => setDialog(null)}><Rating value={dialog.item.rating} readonly showValue />{dialog.item.approach && <p>Подход: {dialog.item.approach.name}</p>}<div className="knowledge-card__metadata knowledge-card__metadata--view">{Object.entries(storedFilters(dialog.item)).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => <span key={key}>{key}: {value}</span>)}</div><div className="knowledge-view"><Suspense fallback={<span>Загрузка предпросмотра…</span>}><MarkdownEditor value={dialog.item.content} onChange={() => undefined} readonly /></Suspense></div></ModalDialog>}
			{dialog?.type === 'delete' && <ModalDialog title="Удалить элемент?" confirmLabel="Удалить" danger onClose={() => setDialog(null)} onConfirm={() => void removeItem(dialog.item)}><p>«{dialog.item.title}» будет удалён из базы знаний.</p></ModalDialog>}
		</main>
		{sidebarOpen && <button className="chat-shell__backdrop" type="button" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню" />}
	</div>;
}

export default KnowledgePage;
