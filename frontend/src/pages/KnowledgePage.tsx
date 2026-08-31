import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
	createKnowledgeFilter,
	createKnowledgeFilterOption,
	createKnowledgeItem,
	deleteKnowledgeFilter,
	deleteKnowledgeFilterOption,
	deleteConversation,
	deleteKnowledgeItem,
	listConversations,
	listKnowledge,
	listKnowledgeFilters,
	renameConversation,
	renameKnowledgeFilter,
	renameKnowledgeFilterOption,
	updateKnowledgeItem,
	uploadKnowledgeFile,
} from '../api/chatApi';
import { ChatSidebar } from '../components/ChatSidebar/ChatSidebar';
import { useToast } from '../components/Toast/ToastContext';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Rating } from '../components/ui/Rating/Rating';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { getStoredAccentTheme, setAccentTheme, type AccentTheme } from '../theme/accentTheme';
import type { AuthUser, ConversationSummary, KnowledgeFilterDefinition, KnowledgeFilterOption, KnowledgeFilterSelection, KnowledgeItem, SelectedKnowledgeFilters } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';

const MarkdownEditor = lazy(() => import('../components/MarkdownEditor/MarkdownEditor'));

type DialogState = { type: 'view' | 'edit' | 'delete'; item: KnowledgeItem } | { type: 'add' } | null;
type FilterDialogState =
	| { type: 'manage' | 'rename-filter' | 'delete-filter'; filterId: string }
	| { type: 'add-option'; filterId: string }
	| { type: 'rename-option' | 'delete-option'; filterId: string; optionId: string }
	| null;
type RatingFilter = 'all' | '5' | '4' | '3' | 'unrated';
type SortMode = 'date_desc' | 'date_asc' | 'rating_desc' | 'rating_asc';

function storedCollapsed() {
	try {
		return window.localStorage.getItem('velorian-sidebar-collapsed') === 'true';
	} catch {
		return false;
	}
}

function extractionStatusLabel(item: KnowledgeItem) {
	if (item.sourceType !== 'uploaded_file') return null;
	const status = item.metadata.extractionStatus;
	if (status === 'empty') return 'Файл не содержит извлекаемого текста';
	if (status === 'ocr_unavailable') return 'Текст изображения не извлечён: OCR недоступен';
	if (status === 'unsupported') return 'Извлечение текста для формата не поддерживается';
	return null;
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
	const [isActive, setIsActive] = useState(true);
	const [filterDefinitions, setFilterDefinitions] = useState<KnowledgeFilterDefinition[]>([]);
	const [selectedFilterOptions, setSelectedFilterOptions] = useState<SelectedKnowledgeFilters>({});
	const [filtersLoaded, setFiltersLoaded] = useState(false);
	const [filterDialog, setFilterDialog] = useState<FilterDialogState>(null);
	const [filterMutationValue, setFilterMutationValue] = useState('');
	const [filterMutationError, setFilterMutationError] = useState('');
	const [metadataMutationPending, setMetadataMutationPending] = useState(false);
	const [newFilterName, setNewFilterName] = useState('');
	const [newOptionValues, setNewOptionValues] = useState<Record<string, string>>({});
	const [showFilterCreator, setShowFilterCreator] = useState(false);
	const [creatingMetadata, setCreatingMetadata] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationSearch, setConversationSearch] = useState('');
	const [accent, setAccent] = useState<AccentTheme>(getStoredAccentTheme);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(storedCollapsed);
	const { showToast } = useToast();

	useEffect(() => {
		listConversations()
			.then(setConversations)
			.catch((error: unknown) => reportError('KNOWLEDGE_SIDEBAR_CHATS_FAILED', error));
		listKnowledgeFilters()
			.then(setFilterDefinitions)
			.catch((error: unknown) => {
				reportError('KNOWLEDGE_FILTERS_FAILED', error);
				showToast(error instanceof Error ? error.message : 'Не удалось загрузить фильтры', 'error');
			})
			.finally(() => setFiltersLoaded(true));
	}, [showToast]);

	const pageFilterSelections = useMemo<KnowledgeFilterSelection[]>(() => filterDefinitions.flatMap((definition) => {
		const raw = params.get(`filter.${definition.id}`);
		const optionIds = raw ? raw.split(',').filter(Boolean) : [];
		return optionIds.length ? [{ filterId: definition.id, optionIds }] : [];
	}), [filterDefinitions, params]);

	useEffect(() => {
		if (!filtersLoaded) return;
		const next = new URLSearchParams(params);
		let changed = false;
		for (const key of Array.from(next.keys())) {
			if (!key.startsWith('filter.')) continue;
			const filterId = key.slice('filter.'.length);
			const definition = filterDefinitions.find((item) => item.id === filterId);
			const validIds = new Set(definition?.options.map((option) => option.id) ?? []);
			const selected = (next.get(key) ?? '').split(',').filter((optionId) => validIds.has(optionId));
			if (!definition || selected.length === 0) next.delete(key);
			else next.set(key, selected.join(','));
			if ((params.get(key) ?? '') !== (next.get(key) ?? '')) changed = true;
		}
		if (changed) setParams(next, { replace: true });
	}, [filterDefinitions, filtersLoaded, params, setParams]);

	useEffect(() => {
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setLoading(true);
			listKnowledge({
				search: params.get('q') || undefined,
				sourceType: sourceType || undefined,
				filters: pageFilterSelections,
				isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
				minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter),
				unrated: ratingFilter === 'unrated',
				sort,
				limit: 20,
			})
				.then((result) => {
					if (!cancelled) {
						setItems(result.items);
						setNextCursor(result.pageInfo.nextCursor);
					}
				})
				.catch((error: unknown) => {
					reportError('KNOWLEDGE_LIST_FAILED', error);
					if (!cancelled)
						showToast(error instanceof Error ? error.message : 'Не удалось загрузить базу знаний', 'error');
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
		}, 250);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [activeFilter, pageFilterSelections, params, ratingFilter, showToast, sort, sourceType]);

	const filteredConversations = useMemo(() => {
		const query = conversationSearch.trim().toLocaleLowerCase('ru');
		return query ? conversations.filter((item) => item.title.toLocaleLowerCase('ru').includes(query)) : conversations;
	}, [conversationSearch, conversations]);
	const counts = useMemo(
		() => ({ total: items.length, active: items.filter((item) => item.isActive).length }),
		[items],
	);
	const systemFilterDefinitions = filterDefinitions.filter((definition) => definition.isSystem);
	const customFilterDefinitions = filterDefinitions.filter((definition) => !definition.isSystem);
	const activeCustomFilterCount = customFilterDefinitions.filter((definition) => params.has(`filter.${definition.id}`)).length;

	function setFilter(name: string, value: string, defaultValue = '') {
		const next = new URLSearchParams(params);
		if (value && value !== defaultValue) next.set(name, value);
		else next.delete(name);
		setParams(next);
	}
	function setPageFilterSelection(filterId: string, optionIds: string[]) {
		const next = new URLSearchParams(params);
		const key = `filter.${filterId}`;
		if (optionIds.length) next.set(key, Array.from(new Set(optionIds)).join(','));
		else next.delete(key);
		setParams(next);
	}
	function handleSearchChange(value: string) {
		setSearch(value);
		const next = new URLSearchParams(params);
		if (value.trim()) next.set('q', value.trim());
		else next.delete('q');
		setParams(next, { replace: true });
	}
	function openAdd() {
		setTitle('');
		setContent('');
		setRating(null);
		setIsActive(true);
		setSelectedFilterOptions({});
		setFile(null);
		setDialog({ type: 'add' });
	}
	function openEdit(item: KnowledgeItem) {
		setTitle(item.title);
		setContent(item.content);
		setRating(item.rating);
		setIsActive(item.isActive);
		const selected: SelectedKnowledgeFilters = {};
		for (const value of item.filters) selected[value.filterId] = [...(selected[value.filterId] ?? []), value.optionId];
		setSelectedFilterOptions(selected);
		setFile(null);
		setDialog({ type: 'edit', item });
	}
	function resetFilters() {
		setSearch('');
		setParams({}, { replace: true });
	}
	const hasActiveFilters = Boolean(
		search.trim() ||
		sourceType ||
		Array.from(params.keys()).some((key) => key.startsWith('filter.')) ||
		activeFilter !== 'all' ||
		ratingFilter !== 'all' ||
		sort !== 'date_desc',
	);
	const formFilterSelections = Object.entries(selectedFilterOptions)
		.filter(([, optionIds]) => optionIds.length > 0)
		.map(([filterId, optionIds]) => ({ filterId, optionIds: Array.from(new Set(optionIds)) }));

	async function addFilter() {
		const name = newFilterName.trim();
		if (!name || creatingMetadata) return;
		setCreatingMetadata(true);
		try {
			const created = await createKnowledgeFilter(name);
			setFilterDefinitions((current) => [...current, created]);
			setNewFilterName('');
			setShowFilterCreator(false);
			showToast('Фильтр создан', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось создать фильтр', 'error');
		} finally {
			setCreatingMetadata(false);
		}
	}
	function refreshFilterSchema() {
		void listKnowledgeFilters()
			.then(setFilterDefinitions)
			.catch((error: unknown) => reportError('KNOWLEDGE_FILTER_REFRESH_FAILED', error));
	}
	async function addFilterOption(definition: KnowledgeFilterDefinition) {
		const value = (newOptionValues[definition.id] ?? '').trim();
		if (!value || creatingMetadata) return;
		setCreatingMetadata(true);
		try {
			const created = await createKnowledgeFilterOption(definition.id, value);
			setFilterDefinitions((current) => current.map((item) => item.id === definition.id ? { ...item, options: [...item.options, created] } : item));
			setSelectedFilterOptions((current) => ({
				...current,
				[definition.id]: [...(current[definition.id] ?? []), created.id],
			}));
			setNewOptionValues((current) => ({ ...current, [definition.id]: '' }));
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось создать значение', 'error');
		} finally {
			setCreatingMetadata(false);
		}
	}
	function openFilterDialog(next: NonNullable<FilterDialogState>, value = '') {
		setFilterMutationValue(value);
		setFilterMutationError('');
		setFilterDialog(next);
	}
	async function runMetadataMutation(action: () => Promise<void>) {
		if (metadataMutationPending) return;
		setMetadataMutationPending(true);
		setFilterMutationError('');
		try {
			await action();
		} catch (error) {
			setFilterMutationError(error instanceof Error ? error.message : 'Не удалось выполнить действие');
		} finally {
			setMetadataMutationPending(false);
		}
	}
	async function submitFilterRename(filter: KnowledgeFilterDefinition) {
		await runMetadataMutation(async () => {
			const updated = await renameKnowledgeFilter(filter.id, filterMutationValue.trim());
			setFilterDefinitions((current) => current.map((item) => item.id === updated.id ? updated : item));
			setItems((current) => current.map((item) => ({
				...item,
				filters: item.filters.map((value) => value.filterId === updated.id ? { ...value, filterName: updated.name, filterSlug: updated.slug } : value),
			})));
			setFilterDialog({ type: 'manage', filterId: updated.id });
		});
	}
	async function submitOptionRename(filter: KnowledgeFilterDefinition, option: KnowledgeFilterOption) {
		await runMetadataMutation(async () => {
			const updated = await renameKnowledgeFilterOption(filter.id, option.id, filterMutationValue.trim());
			setFilterDefinitions((current) => current.map((item) => item.id === filter.id ? {
				...item, options: item.options.map((entry) => entry.id === updated.id ? updated : entry),
			} : item));
			setItems((current) => current.map((item) => ({
				...item,
				filters: item.filters.map((value) => value.optionId === updated.id ? { ...value, value: updated.value } : value),
			})));
			setFilterDialog({ type: 'manage', filterId: filter.id });
		});
	}
	async function submitManagedOption(filter: KnowledgeFilterDefinition) {
		await runMetadataMutation(async () => {
			const created = await createKnowledgeFilterOption(filter.id, filterMutationValue.trim());
			setFilterDefinitions((current) => current.map((item) => item.id === filter.id ? {
				...item, options: [...item.options, created],
			} : item));
			setFilterDialog({ type: 'manage', filterId: filter.id });
		});
	}
	async function removeFilterOption(filter: KnowledgeFilterDefinition, option: KnowledgeFilterOption) {
		await runMetadataMutation(async () => {
			await deleteKnowledgeFilterOption(filter.id, option.id);
			setFilterDefinitions(await listKnowledgeFilters());
			setItems((current) => current.map((item) => ({ ...item, filters: item.filters.filter((value) => value.optionId !== option.id) })));
			setSelectedFilterOptions((current) => ({
				...current,
				[filter.id]: (current[filter.id] ?? []).filter((optionId) => optionId !== option.id),
			}));
			const next = new URLSearchParams(params);
			const remaining = (next.get(`filter.${filter.id}`) ?? '').split(',').filter((optionId) => optionId && optionId !== option.id);
			if (remaining.length) next.set(`filter.${filter.id}`, remaining.join(','));
			else next.delete(`filter.${filter.id}`);
			setParams(next, { replace: true });
			setFilterDialog({ type: 'manage', filterId: filter.id });
		});
	}
	async function removeFilterDefinition(filter: KnowledgeFilterDefinition) {
		await runMetadataMutation(async () => {
			await deleteKnowledgeFilter(filter.id);
			setFilterDefinitions(await listKnowledgeFilters());
			setItems((current) => current.map((item) => ({ ...item, filters: item.filters.filter((value) => value.filterId !== filter.id) })));
			setSelectedFilterOptions((current) => {
				const next = { ...current };
				delete next[filter.id];
				return next;
			});
			const next = new URLSearchParams(params);
			next.delete(`filter.${filter.id}`);
			setParams(next, { replace: true });
			setFilterDialog(null);
		});
	}
	function markPending(id: string, pending: boolean) {
		setPendingItemIds((current) => {
			const next = new Set(current);
			if (pending) next.add(id);
			else next.delete(id);
			return next;
		});
	}

	async function saveDialog() {
		try {
			if (dialog?.type === 'add') {
				const created = file
					? await uploadKnowledgeFile(file, title, rating, isActive, null, [], formFilterSelections)
					: await createKnowledgeItem(title.trim(), content, rating, isActive, null, [], formFilterSelections);
				setItems((current) => [created, ...current]);
				refreshFilterSchema();
				showToast('Данные добавлены в базу знаний', 'success');
			} else if (dialog?.type === 'edit') {
				const updated = await updateKnowledgeItem(dialog.item.id, {
					title: title.trim(),
					content,
					rating,
					isActive,
					filters: formFilterSelections,
				});
				setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
				refreshFilterSchema();
				showToast('Изменения сохранены', 'success');
			}
			setDialog(null);
		} catch (error) {
			reportError('KNOWLEDGE_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить данные', 'error');
		}
	}

	async function changeRating(item: KnowledgeItem, value: number | null) {
		if (pendingItemIds.has(item.id)) return;
		const previous = item.rating;
		markPending(item.id, true);
		setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, rating: value } : entry)));
		try {
			const updated = await updateKnowledgeItem(item.id, { rating: value });
			setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
		} catch (error) {
			setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, rating: previous } : entry)));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить рейтинг', 'error');
		} finally {
			markPending(item.id, false);
		}
	}

	async function toggleItem(item: KnowledgeItem, nextActive: boolean) {
		if (pendingItemIds.has(item.id)) return;
		markPending(item.id, true);
		setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, isActive: nextActive } : entry)));
		try {
			const updated = await updateKnowledgeItem(item.id, { isActive: nextActive });
			setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
		} catch (error) {
			setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить состояние', 'error');
		} finally {
			markPending(item.id, false);
		}
	}

	async function removeItem(item: KnowledgeItem) {
		try {
			await deleteKnowledgeItem(item.id);
			setItems((current) => current.filter((entry) => entry.id !== item.id));
			refreshFilterSchema();
			setDialog(null);
			showToast('Элемент удалён', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось удалить элемент', 'error');
		}
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const result = await listKnowledge({
				search: params.get('q') || undefined,
				sourceType: sourceType || undefined,
				filters: pageFilterSelections,
				isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
				minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter),
				unrated: ratingFilter === 'unrated',
				sort,
				limit: 20,
				cursor: nextCursor,
			});
			setItems((current) => [...current, ...result.items]);
			setNextCursor(result.pageInfo.nextCursor);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось загрузить следующую страницу', 'error');
		} finally {
			setLoadingMore(false);
		}
	}
	const metadataFields = (
		<div className="knowledge-form__approach">
			<strong>Дополнительные фильтры</strong>
			{filterDefinitions.map((definition) => (
				<div key={definition.id} className="knowledge-form__metadata-row">
					<label>{definition.name}
						<select multiple aria-label={`${definition.name} элемента`} value={selectedFilterOptions[definition.id] ?? []} onChange={(event) => {
							const optionIds = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
							setSelectedFilterOptions((current) => ({ ...current, [definition.id]: optionIds }));
						}}>
							{definition.options.map((option) => <option key={option.id} value={option.id}>{option.value}</option>)}
						</select>
					</label>
					<div className="knowledge-form__approach-create">
						<input aria-label={`Новое значение ${definition.name}`} placeholder="Новое значение" value={newOptionValues[definition.id] ?? ''} onChange={(event) => setNewOptionValues((current) => ({ ...current, [definition.id]: event.target.value }))} />
						<button type="button" disabled={creatingMetadata || !(newOptionValues[definition.id] ?? '').trim()} onClick={() => void addFilterOption(definition)}>Добавить</button>
					</div>
				</div>
			))}
		</div>
	);
	const managedFilter = filterDialog ? filterDefinitions.find((definition) => definition.id === filterDialog.filterId) : undefined;
	const managedOption = managedFilter && filterDialog && 'optionId' in filterDialog
		? managedFilter.options.find((option) => option.id === filterDialog.optionId)
		: undefined;

	return (
		<div className="knowledge-shell">
			<ChatSidebar
				user={user}
				conversations={filteredConversations}
				activeConversationId={null}
				search={conversationSearch}
				accentTheme={accent}
				isOpen={sidebarOpen}
				isCollapsed={sidebarCollapsed}
				activeSection="knowledge"
				onSearchChange={setConversationSearch}
				onSelect={(id) => navigate(`/chat/${encodeURIComponent(id)}`)}
				onNew={() => navigate('/chat/new')}
				onDelete={(id) =>
					void deleteConversation(id).then(() =>
						setConversations((current) => current.filter((item) => item.id !== id)),
					)
				}
				onRename={(conversation, nextTitle) =>
					void renameConversation(conversation.id, nextTitle).then((updated) =>
						setConversations((current) => current.map((item) => (item.id === updated.id ? updated : item))),
					)
				}
				onAccentChange={(theme) => {
					setAccent(theme);
					setAccentTheme(theme);
				}}
				onExport={() => showToast('Откройте чат для экспорта', 'info')}
				onLogout={() => void onLogout()}
				onOpenKnowledge={() => undefined}
				onClose={() => setSidebarOpen(false)}
				onToggleCollapsed={() =>
					setSidebarCollapsed((current) => {
						const next = !current;
						try {
							window.localStorage.setItem('velorian-sidebar-collapsed', String(next));
						} catch {
							/* Storage is optional. */
						}
						return next;
					})
				}
			/>
			<main className="knowledge-page">
				<header>
					<div>
						<button className="knowledge-page__mobile-menu" type="button" onClick={() => setSidebarOpen(true)}>
							☰
						</button>
						<h1>База знаний</h1>
						<p>
							{user.email} · на странице активно {counts.active} из {counts.total}
						</p>
					</div>
					<button className="knowledge-page__add" type="button" onClick={openAdd}>
						Добавить данные
					</button>
				</header>
				<section className="knowledge-page__filters" aria-label="Фильтры базы знаний">
					<input
						value={search}
						onChange={(event) => handleSearchChange(event.target.value)}
						placeholder="Поиск по названию, содержимому и имени файла"
						aria-label="Поиск по базе знаний"
					/>
					<select
						value={sourceType}
						onChange={(event) => setFilter('source', event.target.value)}
						aria-label="Источник"
					>
						<option value="">Все источники</option>
						<option value="manual">Вручную</option>
						<option value="uploaded_file">Файлы</option>
						<option value="assistant_generated_file">Файлы агента</option>
						<option value="rated_content">Оценённые ответы</option>
					</select>
					{systemFilterDefinitions.map((definition) => (
						<div className="knowledge-page__filter-control" key={definition.id}>
							<label>{definition.name}
								<select multiple value={pageFilterSelections.find((group) => group.filterId === definition.id)?.optionIds ?? []} onChange={(event) => setPageFilterSelection(definition.id, Array.from(event.currentTarget.selectedOptions, (option) => option.value))} aria-label={definition.name}>
									{definition.options.map((option) => <option key={option.id} value={option.id}>{option.value}</option>)}
								</select>
							</label>
							<button type="button" aria-label={`Управление фильтром ${definition.name}`} onClick={() => openFilterDialog({ type: 'manage', filterId: definition.id })}>•••</button>
						</div>
					))}
					{customFilterDefinitions.length > 0 && (
						<details className="knowledge-page__extra-filters">
							<summary>Доп. фильтры{activeCustomFilterCount ? ` (${activeCustomFilterCount})` : ''}</summary>
							<div>
								{customFilterDefinitions.map((definition) => (
									<div className="knowledge-page__filter-control" key={definition.id}>
										<label>{definition.name}
										<select multiple value={pageFilterSelections.find((group) => group.filterId === definition.id)?.optionIds ?? []} onChange={(event) => setPageFilterSelection(definition.id, Array.from(event.currentTarget.selectedOptions, (option) => option.value))} aria-label={definition.name}>
											{definition.options.map((option) => <option key={option.id} value={option.id}>{option.value}</option>)}
										</select>
									</label>
										<button type="button" aria-label={`Управление фильтром ${definition.name}`} onClick={() => openFilterDialog({ type: 'manage', filterId: definition.id })}>•••</button>
									</div>
								))}
							</div>
						</details>
					)}
					{showFilterCreator ? (
						<div className="knowledge-page__filter-creator">
							<input aria-label="Название нового фильтра" placeholder="Название фильтра" value={newFilterName} onChange={(event) => setNewFilterName(event.target.value)} />
							<button type="button" disabled={!newFilterName.trim() || creatingMetadata} onClick={() => void addFilter()}>Создать</button>
							<button type="button" onClick={() => setShowFilterCreator(false)}>Отмена</button>
						</div>
					) : <button type="button" onClick={() => setShowFilterCreator(true)}>+ Добавить фильтр</button>}
					<select
						value={ratingFilter}
						onChange={(event) => setFilter('rating', event.target.value, 'all')}
						aria-label="Рейтинг"
					>
						<option value="all">Все рейтинги</option>
						<option value="5">5 из 5</option>
						<option value="4">4 и выше</option>
						<option value="3">3 и выше</option>
						<option value="unrated">Без рейтинга</option>
					</select>
					<select
						value={sort}
						onChange={(event) => setFilter('sort', event.target.value, 'date_desc')}
						aria-label="Сортировка"
					>
						<option value="date_desc">Сначала новые</option>
						<option value="date_asc">Сначала старые</option>
						<option value="rating_desc">Рейтинг: высокий</option>
						<option value="rating_asc">Рейтинг: низкий</option>
					</select>
					<select
						value={activeFilter}
						onChange={(event) => setFilter('active', event.target.value, 'all')}
						aria-label="Использование"
					>
						<option value="all">Все состояния</option>
						<option value="active">Используются агентом</option>
						<option value="inactive">Отключены</option>
					</select>
					<button className="knowledge-page__reset" type="button" disabled={!hasActiveFilters} onClick={resetFilters}>
						Сбросить
					</button>
				</section>
				<section className="knowledge-page__list">
					{loading && <p className="knowledge-page__empty">Загрузка…</p>}
					{!loading && items.length === 0 && <p className="knowledge-page__empty">Сохранённых данных пока нет</p>}
					{!loading &&
						items.map((item) => (
							<article className="knowledge-card" key={item.id}>
								<div className="knowledge-card__head">
									<div>
										<strong>{item.title}</strong>
										<Rating value={item.rating} readonly size="small" showValue ariaLabel={`Рейтинг ${item.title}`} />
										{item.filters.map((value) => <span key={value.optionId} className="knowledge-card__approach">{value.filterName}: {value.value}</span>)}
										<span>
											{item.sourceType === 'rated_content'
												? 'Ответ агента'
											: item.sourceType === 'uploaded_file'
												? 'Файл'
												: item.sourceType === 'assistant_generated_file'
													? 'Файл агента'
												: 'Добавлено вручную'}{' '}
											· {new Date(item.createdAt).toLocaleDateString('ru-RU')}
										</span>
										{extractionStatusLabel(item) && (
											<span className="knowledge-card__extraction-warning">{extractionStatusLabel(item)}</span>
										)}
									</div>
									<Checkbox
										checked={item.isActive}
										disabled={pendingItemIds.has(item.id)}
										onChange={(checked) => void toggleItem(item, checked)}
										label="Использовать"
									/>
								</div>
								<p>{item.content || 'Текстовое содержимое не извлечено'}</p>
								<div className="knowledge-card__actions">
									<button type="button" onClick={() => setDialog({ type: 'view', item })}>
										Открыть
									</button>
									<button type="button" onClick={() => openEdit(item)}>
										Редактировать
									</button>
									{item.downloadUrl && (
										<a href={item.downloadUrl} download>
											Скачать
										</a>
									)}
									<button type="button" onClick={() => void changeRating(item, null)}>
										Убрать рейтинг
									</button>
									<button
										className="knowledge-card__delete"
										type="button"
										onClick={() => setDialog({ type: 'delete', item })}
									>
										Удалить
									</button>
								</div>
							</article>
						))}
					{!loading && nextCursor && (
						<button
							className="knowledge-page__more"
							type="button"
							disabled={loadingMore}
							onClick={() => void loadMore()}
						>
							{loadingMore ? 'Загрузка…' : 'Показать ещё'}
						</button>
					)}
				</section>

				{dialog?.type === 'add' && (
					<ModalDialog
						title="Добавить данные"
						confirmLabel="Добавить"
						onClose={() => setDialog(null)}
						onConfirm={() => void saveDialog()}
					>
						<div className="knowledge-form">
							<input
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="Название"
								aria-label="Название"
							/>
							<Suspense fallback={<div>Загрузка редактора…</div>}>
								<MarkdownEditor value={content} onChange={setContent} />
							</Suspense>
							<span>или загрузите файл</span>
							<input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
							{metadataFields}
							<label>
								Рейтинг (необязательно)
								<Rating value={rating} onChange={setRating} ariaLabel="Рейтинг элемента" />
							</label>
							<Checkbox checked={isActive} onChange={setIsActive} label="Использовать" />
						</div>
					</ModalDialog>
				)}
				{dialog?.type === 'edit' && (
					<ModalDialog
						title="Редактировать данные"
						confirmLabel="Сохранить"
						onClose={() => setDialog(null)}
						onConfirm={() => void saveDialog()}
					>
						<div className="knowledge-form">
							<input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Название" />
							<Suspense fallback={<div>Загрузка редактора…</div>}>
								<MarkdownEditor value={content} onChange={setContent} />
							</Suspense>
							{metadataFields}
							<label>
								Рейтинг
								<Rating value={rating} onChange={setRating} ariaLabel="Рейтинг элемента" />
							</label>
							<Checkbox checked={isActive} onChange={setIsActive} label="Использовать" />
						</div>
					</ModalDialog>
				)}
				{dialog?.type === 'view' && (
					<ModalDialog
						title={dialog.item.title}
						confirmLabel="Закрыть"
						onClose={() => setDialog(null)}
						onConfirm={() => setDialog(null)}
					>
						<Rating value={dialog.item.rating} readonly showValue />
						{dialog.item.filters.map((value) => <p key={value.optionId}>{value.filterName}: {value.value}</p>)}
						<div className="knowledge-view">
							<Suspense fallback={<span>Загрузка предпросмотра…</span>}>
								<MarkdownEditor value={dialog.item.content} onChange={() => undefined} readonly />
							</Suspense>
						</div>
					</ModalDialog>
				)}
				{dialog?.type === 'delete' && (
					<ModalDialog
						title="Удалить элемент?"
						confirmLabel="Удалить"
						danger
						onClose={() => setDialog(null)}
						onConfirm={() => void removeItem(dialog.item)}
					>
						<p>«{dialog.item.title}» будет удалён из базы знаний.</p>
					</ModalDialog>
				)}
				{filterDialog?.type === 'manage' && managedFilter && (
					<ModalDialog title={`Фильтр «${managedFilter.name}»`} confirmLabel="Закрыть" onClose={() => setFilterDialog(null)} onConfirm={() => setFilterDialog(null)}>
						<div className="knowledge-filter-manager">
							<p>Используется в {managedFilter.itemCount} записях</p>
							<div className="knowledge-filter-manager__actions">
								<button type="button" onClick={() => openFilterDialog({ type: 'rename-filter', filterId: managedFilter.id }, managedFilter.name)}>Переименовать</button>
								<button type="button" onClick={() => openFilterDialog({ type: 'add-option', filterId: managedFilter.id })}>+ Добавить значение</button>
								{!managedFilter.isSystem && <button className="knowledge-filter-manager__danger" type="button" onClick={() => openFilterDialog({ type: 'delete-filter', filterId: managedFilter.id })}>Удалить фильтр</button>}
							</div>
							<div className="knowledge-filter-manager__options">
								{managedFilter.options.length === 0 && <p>Значений пока нет</p>}
								{managedFilter.options.map((option) => (
									<div key={option.id}>
										<span><strong>{option.value}</strong> — {option.itemCount} записей</span>
										<div>
											<button type="button" aria-label={`Переименовать ${option.value}`} onClick={() => openFilterDialog({ type: 'rename-option', filterId: managedFilter.id, optionId: option.id }, option.value)}>Переименовать</button>
											<button type="button" aria-label={`Удалить ${option.value}`} onClick={() => openFilterDialog({ type: 'delete-option', filterId: managedFilter.id, optionId: option.id })}>Удалить</button>
										</div>
									</div>
								))}
							</div>
						</div>
					</ModalDialog>
				)}
				{filterDialog?.type === 'rename-filter' && managedFilter && (
					<ModalDialog title="Переименовать фильтр" confirmLabel={metadataMutationPending ? 'Сохранение…' : 'Сохранить'} confirmDisabled={metadataMutationPending || !filterMutationValue.trim() || filterMutationValue.trim() === managedFilter.name} onClose={() => setFilterDialog({ type: 'manage', filterId: managedFilter.id })} onConfirm={() => void submitFilterRename(managedFilter)}>
						<label>Название фильтра<input autoFocus value={filterMutationValue} onChange={(event) => setFilterMutationValue(event.target.value)} /></label>
						{filterMutationError && <p className="knowledge-filter-manager__error" role="alert">{filterMutationError}</p>}
					</ModalDialog>
				)}
				{filterDialog?.type === 'add-option' && managedFilter && (
					<ModalDialog title={`Новое значение — ${managedFilter.name}`} confirmLabel={metadataMutationPending ? 'Добавление…' : 'Добавить'} confirmDisabled={metadataMutationPending || !filterMutationValue.trim()} onClose={() => setFilterDialog({ type: 'manage', filterId: managedFilter.id })} onConfirm={() => void submitManagedOption(managedFilter)}>
						<label>Новое значение<input autoFocus value={filterMutationValue} onChange={(event) => setFilterMutationValue(event.target.value)} /></label>
						{filterMutationError && <p className="knowledge-filter-manager__error" role="alert">{filterMutationError}</p>}
					</ModalDialog>
				)}
				{filterDialog?.type === 'rename-option' && managedFilter && managedOption && (
					<ModalDialog title="Переименовать значение" confirmLabel={metadataMutationPending ? 'Сохранение…' : 'Сохранить'} confirmDisabled={metadataMutationPending || !filterMutationValue.trim() || filterMutationValue.trim() === managedOption.value} onClose={() => setFilterDialog({ type: 'manage', filterId: managedFilter.id })} onConfirm={() => void submitOptionRename(managedFilter, managedOption)}>
						<label>Значение<input autoFocus value={filterMutationValue} onChange={(event) => setFilterMutationValue(event.target.value)} /></label>
						{filterMutationError && <p className="knowledge-filter-manager__error" role="alert">{filterMutationError}</p>}
					</ModalDialog>
				)}
				{filterDialog?.type === 'delete-option' && managedFilter && managedOption && (
					<ModalDialog title={`Удалить значение «${managedOption.value}»?`} confirmLabel={metadataMutationPending ? 'Удаление…' : 'Удалить'} danger confirmDisabled={metadataMutationPending} onClose={() => setFilterDialog({ type: 'manage', filterId: managedFilter.id })} onConfirm={() => void removeFilterOption(managedFilter, managedOption)}>
						<p>Оно используется в {managedOption.itemCount} записях. Значение будет удалено из этих записей. Сами материалы удалены не будут.</p>
						{filterMutationError && <p className="knowledge-filter-manager__error" role="alert">{filterMutationError}</p>}
					</ModalDialog>
				)}
				{filterDialog?.type === 'delete-filter' && managedFilter && !managedFilter.isSystem && (
					<ModalDialog title={`Удалить фильтр «${managedFilter.name}»?`} confirmLabel={metadataMutationPending ? 'Удаление…' : 'Удалить'} danger confirmDisabled={metadataMutationPending} onClose={() => setFilterDialog({ type: 'manage', filterId: managedFilter.id })} onConfirm={() => void removeFilterDefinition(managedFilter)}>
						<p>Фильтр используется в {managedFilter.itemCount} записях. Все его значения будут удалены из этих записей. Сами материалы базы знаний удалены не будут.</p>
						{filterMutationError && <p className="knowledge-filter-manager__error" role="alert">{filterMutationError}</p>}
					</ModalDialog>
				)}
			</main>
			{sidebarOpen && (
				<button
					className="chat-shell__backdrop"
					type="button"
					onClick={() => setSidebarOpen(false)}
					aria-label="Закрыть меню"
				/>
			)}
		</div>
	);
}

export default KnowledgePage;
