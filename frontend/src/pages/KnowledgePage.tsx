import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
	createKnowledgeApproach,
	createKnowledgeItem,
	deleteConversation,
	deleteKnowledgeItem,
	listConversations,
	listKnowledge,
	listKnowledgeApproaches,
	renameConversation,
	updateKnowledgeItem,
	uploadKnowledgeFile,
} from '../api/chatApi';
import { ChatSidebar } from '../components/ChatSidebar/ChatSidebar';
import { useDebounce } from '../hooks/useDebounce';
import { useToast } from '../hooks/useToast';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Rating } from '../components/ui/Rating/Rating';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { KnowledgeFilterFields } from '../components/KnowledgeFilterFields/KnowledgeFilterFields';
import type { AuthUser, KnowledgeFilters, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import { useKnowledgeStore } from '../stores/knowledgeStore';
import { useConversationsStore } from '../stores/conversationsStore';
import { useUiStore } from '../stores/uiStore';
import './_knowledgePage.scss';
import { SearchIcon, TrashIcon } from '../components/icons/AppIcons';

const MarkdownEditor = lazy(() => import('../components/MarkdownEditor/MarkdownEditor'));

type RatingFilter = 'all' | '5' | '4' | '3' | 'unrated';
type SortMode = 'date_desc' | 'date_asc' | 'rating_desc' | 'rating_asc';

function extractionStatusLabel(item: KnowledgeItem) {
	if (item.sourceType !== 'uploaded_file') return null;
	const status = item.metadata.extractionStatus;
	if (status === 'empty') return 'Файл не содержит извлекаемого текста';
	if (status === 'ocr_unavailable') return 'Текст изображения не извлечён: OCR недоступен';
	if (status === 'unsupported') return 'Извлечение текста для формата не поддерживается';
	return null;
}

function storedFilters(item: KnowledgeItem): KnowledgeFilters {
	return (
		item.filters ?? {
			geo: typeof item.metadata?.geo === 'string' ? item.metadata.geo : null,
			celebrity: typeof item.metadata?.celebrity === 'string' ? item.metadata.celebrity : null,
			offer: typeof item.metadata?.offer === 'string' ? item.metadata.offer : null,
			news_source: typeof item.metadata?.news_source === 'string' ? item.metadata.news_source : null,
		}
	);
}

export function KnowledgePage({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const debouncedSearch = useDebounce(params.get('q') ?? '', 250);
	const items = useKnowledgeStore((state) => state.items);
	const setItems = useKnowledgeStore((state) => state.setItems);
	const nextCursor = useKnowledgeStore((state) => state.nextCursor);
	const setNextCursor = useKnowledgeStore((state) => state.setNextCursor);
	const search = useKnowledgeStore((state) => state.search);
	const setSearch = useKnowledgeStore((state) => state.setSearch);
	const sourceType = params.get('source') ?? '';
	const approachId = params.get('approach') ?? '';
	const geo = params.get('geo') ?? '';
	const celebrity = params.get('celebrity') ?? '';
	const offer = params.get('offer') ?? '';
	const newsSource = params.get('news_source') ?? '';
	const activeFilter = params.get('active') ?? 'all';
	const ratingFilter = (params.get('rating') as RatingFilter | null) ?? 'all';
	const sort = (params.get('sort') as SortMode | null) ?? 'date_desc';
	const loading = useKnowledgeStore((state) => state.isLoading);
	const setLoading = useKnowledgeStore((state) => state.setLoading);
	const loadingMore = useKnowledgeStore((state) => state.isLoadingMore);
	const setLoadingMore = useKnowledgeStore((state) => state.setLoadingMore);
	const dialog = useKnowledgeStore((state) => state.dialog);
	const setDialog = useKnowledgeStore((state) => state.setDialog);
	const title = useKnowledgeStore((state) => state.title);
	const setTitle = useKnowledgeStore((state) => state.setTitle);
	const content = useKnowledgeStore((state) => state.content);
	const setContent = useKnowledgeStore((state) => state.setContent);
	const rating = useKnowledgeStore((state) => state.rating);
	const setRating = useKnowledgeStore((state) => state.setRating);
	const isActive = useKnowledgeStore((state) => state.isActive);
	const setIsActive = useKnowledgeStore((state) => state.setActive);
	const selectedApproachId = useKnowledgeStore((state) => state.selectedApproachId);
	const setSelectedApproachId = useKnowledgeStore((state) => state.setSelectedApproachId);
	const formFilters = useKnowledgeStore((state) => state.formFilters);
	const setFormFilters = useKnowledgeStore((state) => state.setFormFilters);
	const saving = useKnowledgeStore((state) => state.isSaving);
	const setSaving = useKnowledgeStore((state) => state.setSaving);
	const approaches = useKnowledgeStore((state) => state.approaches);
	const setApproaches = useKnowledgeStore((state) => state.setApproaches);
	const newApproachName = useKnowledgeStore((state) => state.newApproachName);
	const setNewApproachName = useKnowledgeStore((state) => state.setNewApproachName);
	const showApproachCreator = useKnowledgeStore((state) => state.showApproachCreator);
	const setShowApproachCreator = useKnowledgeStore((state) => state.setShowApproachCreator);
	const creatingApproach = useKnowledgeStore((state) => state.isCreatingApproach);
	const setCreatingApproach = useKnowledgeStore((state) => state.setCreatingApproach);
	const file = useKnowledgeStore((state) => state.file);
	const setFile = useKnowledgeStore((state) => state.setFile);
	const pendingItemIds = useKnowledgeStore((state) => state.pendingItemIds);
	const markPending = useKnowledgeStore((state) => state.markPending);
	const openAdd = useKnowledgeStore((state) => state.openAdd);
	const openEdit = useKnowledgeStore((state) => state.openEdit);
	const resetApproachCreator = useKnowledgeStore((state) => state.resetApproachCreator);
	const setConversations = useConversationsStore((state) => state.setConversations);
	const sidebarOpen = useUiStore((state) => state.isSidebarOpen);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const { showToast } = useToast();

	const [activeDropdown, setActiveDropdown] = useState<'filters' | 'sort' | null>(null);
	const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	const [bulkDeleting, setBulkDeleting] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const selectedItems = useMemo(() => items.filter((item) => selectedItemIds.has(item.id)), [items, selectedItemIds]);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setActiveDropdown(null);
			}
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setActiveDropdown(null);
		}
		if (activeDropdown) {
			document.addEventListener('mousedown', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
		}
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [activeDropdown]);

	useEffect(() => {
		setSearch(params.get('q') ?? '');
		// URL is the source of truth only when the page is entered.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		listConversations()
			.then(setConversations)
			.catch((error: unknown) => reportError('KNOWLEDGE_SIDEBAR_CHATS_FAILED', error));
		listKnowledgeApproaches()
			.then(setApproaches)
			.catch((error: unknown) => {
				reportError('KNOWLEDGE_APPROACHES_FAILED', error);
				showToast(error instanceof Error ? error.message : 'Не удалось загрузить подходы', 'error');
			});
	}, [setApproaches, setConversations, showToast]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		listKnowledge({
			search: debouncedSearch || undefined,
			sourceType: sourceType || undefined,
			approachId: approachId || undefined,
			filters: { geo, celebrity, offer, news_source: newsSource },
			isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
			minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter),
			unrated: ratingFilter === 'unrated',
			sort,
			limit: 20,
		})
			.then((result) => {
				if (!cancelled) {
					setItems(result.items);
					setSelectedItemIds(new Set());
					setNextCursor(result.pageInfo.nextCursor);
				}
			})
			.catch((error: unknown) => {
				reportError('KNOWLEDGE_LIST_FAILED', error);
				if (!cancelled) showToast(error instanceof Error ? error.message : 'Не удалось загрузить базу знаний', 'error');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [
		activeFilter,
		approachId,
		celebrity,
		debouncedSearch,
		geo,
		newsSource,
		offer,
		ratingFilter,
		setItems,
		setLoading,
		setNextCursor,
		showToast,
		sort,
		sourceType,
	]);

	const counts = useMemo(
		() => ({ total: items.length, active: items.filter((item) => item.isActive).length }),
		[items],
	);

	function setFilter(name: string, value: string, defaultValue = '') {
		const next = new URLSearchParams(params);
		if (value && value !== defaultValue) next.set(name, value);
		else next.delete(name);
		setParams(next);
	}
	function handleSearchChange(value: string) {
		setSearch(value);
		const next = new URLSearchParams(params);
		if (value.trim()) next.set('q', value.trim());
		else next.delete('q');
		setParams(next, { replace: true });
	}

	function resetFiltersOnly() {
		const next = new URLSearchParams(params);
		['source', 'approach', 'geo', 'celebrity', 'offer', 'news_source', 'rating', 'active'].forEach((key) =>
			next.delete(key),
		);
		setParams(next);
	}

	const activeFiltersCount = [
		sourceType,
		approachId,
		geo,
		celebrity,
		offer,
		newsSource,
		ratingFilter !== 'all' ? ratingFilter : '',
		activeFilter !== 'all' ? activeFilter : '',
	].filter(Boolean).length;

	async function addApproach() {
		const name = newApproachName.trim();
		if (!name || creatingApproach) return;
		setCreatingApproach(true);
		try {
			const created = await createKnowledgeApproach(name);
			setApproaches((current) =>
				[...current, created].sort((left, right) => left.name.localeCompare(right.name, 'ru')),
			);
			setSelectedApproachId(created.id);
			resetApproachCreator();
			showToast('Подход создан', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось создать подход', 'error');
		} finally {
			setCreatingApproach(false);
		}
	}
	async function saveDialog() {
		if (saving) return;
		setSaving(true);
		try {
			if (dialog?.type === 'add') {
				const created = file
					? await uploadKnowledgeFile(file, title, rating, isActive, selectedApproachId || null, formFilters)
					: await createKnowledgeItem(title.trim(), content, rating, isActive, selectedApproachId || null, formFilters);
				setItems((current) => [created, ...current]);
				showToast('Данные добавлены в базу знаний', 'success');
			} else if (dialog?.type === 'edit') {
				const updated = await updateKnowledgeItem(dialog.item.id, {
					title: title.trim(),
					content,
					rating,
					isActive,
					approachId: selectedApproachId || null,
					filters: formFilters,
				});
				setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
				showToast('Изменения сохранены', 'success');
			}
			setDialog(null);
		} catch (error) {
			reportError('KNOWLEDGE_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить данные', 'error');
		} finally {
			setSaving(false);
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
			setSelectedItemIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
			setDialog(null);
			showToast('Элемент удалён', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось удалить элемент', 'error');
		}
	}

	function toggleSelectedItem(itemId: string, selected: boolean) {
		setSelectedItemIds((current) => {
			const next = new Set(current);
			if (selected) next.add(itemId);
			else next.delete(itemId);
			return next;
		});
	}

	async function removeSelectedItems() {
		if (selectedItems.length === 0 || bulkDeleting) return;
		setBulkDeleting(true);
		const results = await Promise.allSettled(selectedItems.map((item) => deleteKnowledgeItem(item.id)));
		const deletedIds = new Set<string>();
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') deletedIds.add(selectedItems[index].id);
		});
		if (deletedIds.size > 0) {
			setItems((current) => current.filter((item) => !deletedIds.has(item.id)));
			setSelectedItemIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
		}
		const failedCount = results.length - deletedIds.size;
		showToast(
			failedCount > 0
				? `Удалено: ${deletedIds.size}. Не удалось удалить: ${failedCount}`
				: `Удалено элементов: ${deletedIds.size}`,
			failedCount > 0 ? 'error' : 'success',
		);
		setBulkDeleting(false);
		setBulkDeleteOpen(false);
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const result = await listKnowledge({
				search: params.get('q') || undefined,
				sourceType: sourceType || undefined,
				approachId: approachId || undefined,
				filters: { geo, celebrity, offer, news_source: newsSource },
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
	const approachField = (
		<div className="knowledge-form__approach">
			<label>
				Подход
				<select
					value={selectedApproachId}
					onChange={(event) => setSelectedApproachId(event.target.value)}
					aria-label="Подход элемента"
				>
					<option value="">Без подхода</option>
					{approaches.map((approach) => (
						<option key={approach.id} value={approach.id}>
							{approach.name}
						</option>
					))}
				</select>
			</label>
			{showApproachCreator ? (
				<div className="knowledge-form__approach-create">
					<input
						value={newApproachName}
						onChange={(event) => setNewApproachName(event.target.value)}
						placeholder="Название нового подхода"
						aria-label="Название нового подхода"
						maxLength={80}
					/>
					<button
						type="button"
						disabled={!newApproachName.trim() || creatingApproach}
						onClick={() => void addApproach()}
					>
						{creatingApproach ? 'Создание…' : 'Создать'}
					</button>
					<button type="button" onClick={resetApproachCreator}>
						Отмена
					</button>
				</div>
			) : (
				<button className="knowledge-form__new-approach" type="button" onClick={() => setShowApproachCreator(true)}>
					Создать новый подход
				</button>
			)}
		</div>
	);
	const filterFields = <KnowledgeFilterFields value={formFilters} onChange={setFormFilters} disabled={saving} />;

	return (
		<div className="knowledge-shell">
			<ChatSidebar
				user={user}
				activeConversationId={null}
				activeSection="knowledge"
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
				onExport={() => showToast('Откройте чат для экспорта', 'info')}
				onLogout={() => void onLogout()}
				onOpenKnowledge={() => undefined}
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
				<section className="knowledge-page__controls" aria-label="Управление базой знаний" ref={dropdownRef}>
					<div className="knowledge-page__search-row">
						<div className="knowledge-page__search">
							<SearchIcon className="knowledge-page__search-icon" />

							<input
								className="knowledge-page__search-input"
								value={search}
								onChange={(event) => handleSearchChange(event.target.value)}
								placeholder="Поиск по названию, содержимому и имени файла"
								aria-label="Поиск по базе знаний"
							/>
						</div>

						<button
							className={`knowledge-page__control-btn ${activeDropdown === 'filters' ? 'active' : ''}`}
							type="button"
							aria-expanded={activeDropdown === 'filters'}
							onClick={() => setActiveDropdown(activeDropdown === 'filters' ? null : 'filters')}
						>
							Фильтры {activeFiltersCount > 0 && <span>{activeFiltersCount}</span>}
						</button>

						<button
							className={`knowledge-page__control-btn ${activeDropdown === 'sort' ? 'active' : ''}`}
							type="button"
							aria-expanded={activeDropdown === 'sort'}
							onClick={() => setActiveDropdown(activeDropdown === 'sort' ? null : 'sort')}
						>
							Сортировка
						</button>
					</div>

					{activeDropdown === 'filters' && (
						<div className="knowledge-page__dropdown knowledge-page__dropdown--filters">
							<div className="knowledge-page__dropdown-grid">
								<label>
									Источник
									<select value={sourceType} onChange={(event) => setFilter('source', event.target.value)}>
										<option value="">Все источники</option>
										<option value="manual">Вручную</option>
										<option value="uploaded_file">Файлы</option>
										<option value="rated_content">Оценённые ответы</option>
									</select>
								</label>
								<label>
									Подход
									<select value={approachId} onChange={(event) => setFilter('approach', event.target.value)}>
										<option value="">Все подходы</option>
										{approaches.map((approach) => (
											<option key={approach.id} value={approach.id}>
												{approach.name}
											</option>
										))}
									</select>
								</label>
								<label>
									Рейтинг
									<select value={ratingFilter} onChange={(event) => setFilter('rating', event.target.value, 'all')}>
										<option value="all">Все рейтинги</option>
										<option value="5">5 из 5</option>
										<option value="4">4 и выше</option>
										<option value="3">3 и выше</option>
										<option value="unrated">Без рейтинга</option>
									</select>
								</label>
								<label>
									Использование
									<select value={activeFilter} onChange={(event) => setFilter('active', event.target.value, 'all')}>
										<option value="all">Все состояния</option>
										<option value="active">Используются агентом</option>
										<option value="inactive">Отключены</option>
									</select>
								</label>
								<label>
									ГЕО
									<input value={geo} onChange={(event) => setFilter('geo', event.target.value)} placeholder="ГЕО" />
								</label>
								<label>
									Селеба
									<input
										value={celebrity}
										onChange={(event) => setFilter('celebrity', event.target.value)}
										placeholder="Селеба"
									/>
								</label>
								<label>
									Оффер
									<input
										value={offer}
										onChange={(event) => setFilter('offer', event.target.value)}
										placeholder="Оффер"
									/>
								</label>
								<label>
									Новостник
									<input
										value={newsSource}
										onChange={(event) => setFilter('news_source', event.target.value)}
										placeholder="Новостник"
									/>
								</label>
							</div>
							<div className="knowledge-page__dropdown-actions">
								<button
									className="knowledge-page__reset-small"
									type="button"
									disabled={activeFiltersCount === 0}
									onClick={resetFiltersOnly}
								>
									Сбросить
								</button>
							</div>
						</div>
					)}

					{activeDropdown === 'sort' && (
						<div className="knowledge-page__dropdown knowledge-page__dropdown--sort">
							{[
								{ label: 'Сначала новые', value: 'date_desc' },
								{ label: 'Сначала старые', value: 'date_asc' },
								{ label: 'Рейтинг: высокий', value: 'rating_desc' },
								{ label: 'Рейтинг: низкий', value: 'rating_asc' },
							].map((item) => (
								<button
									key={item.value}
									className={`knowledge-page__sort-option ${sort === item.value ? 'active' : ''}`}
									type="button"
									onClick={() => {
										setFilter('sort', item.value, 'date_desc');
										setActiveDropdown(null);
									}}
								>
									{item.label}
								</button>
							))}
						</div>
					)}
				</section>
				<div className="knowledge-page__bulk-slot">
					{selectedItems.length > 0 && (
						<div className="knowledge-page__bulk-bar" role="region" aria-label="Действия с выбранными элементами">
							<strong>Выбрано: {selectedItems.length}</strong>
							<button
								type="button"
								disabled={selectedItems.length === items.length}
								onClick={() => setSelectedItemIds(new Set(items.map((item) => item.id)))}
							>
								Выбрать все {items.length}
							</button>
							<button type="button" onClick={() => setSelectedItemIds(new Set())}>
								Снять выбор
							</button>
							<button className="knowledge-page__bulk-delete" type="button" onClick={() => setBulkDeleteOpen(true)}>
								<TrashIcon />
								Удалить {selectedItems.length}
							</button>
						</div>
					)}
				</div>
				<section className="knowledge-page__list">
					{loading && <p className="knowledge-page__empty">Загрузка…</p>}
					{!loading && items.length === 0 && <p className="knowledge-page__empty">Сохранённых данных пока нет</p>}
					{!loading &&
						items.map((item) => (
							<article
								className={`knowledge-card ${selectedItemIds.has(item.id) ? 'knowledge-card--selected' : ''}`}
								key={item.id}
							>
								<div className="knowledge-card__head">
									<div>
										<div className="knowledge-card__title-row">
											<Checkbox
												checked={selectedItemIds.has(item.id)}
												onChange={(checked) => toggleSelectedItem(item.id, checked)}
												label={`Выбрать ${item.title}`}
												className="knowledge-card__select"
											/>
											<strong>{`${item.title}`}</strong>
										</div>
										<Rating value={item.rating} readonly size="small" showValue ariaLabel={`Рейтинг ${item.title}`} />
										{item.approach && <span className="knowledge-card__approach">Подход: {item.approach.name}</span>}
										<div className="knowledge-card__metadata">
											{Object.entries(storedFilters(item))
												.filter((entry): entry is [string, string] => Boolean(entry[1]))
												.map(([key, value]) => (
													<span key={key}>
														{
															(
																{ geo: 'ГЕО', celebrity: 'Селеба', offer: 'Оффер', news_source: 'Новостник' } as Record<
																	string,
																	string
																>
															)[key]
														}
														: {value}
													</span>
												))}
										</div>
										<span>
											{item.sourceType === 'rated_content'
												? 'Ответ агента'
												: item.sourceType === 'assistant_file'
													? 'Файл из диалога'
													: item.sourceType === 'uploaded_file'
														? 'Файл'
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
										className="knowledge-card__active-toggle"
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
										<a href={item.downloadUrl} download={item.fileName}>
											Скачать .md
										</a>
									)}
									{item.originalDownloadUrl && (
										<a href={item.originalDownloadUrl} download={item.originalFilename ?? undefined}>
											Скачать оригинал
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
						confirmLabel={saving ? 'Добавление…' : 'Добавить'}
						confirmDisabled={saving}
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

							{filterFields}
							{approachField}

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
						confirmLabel={saving ? 'Сохранение…' : 'Сохранить'}
						confirmDisabled={saving}
						onClose={() => setDialog(null)}
						onConfirm={() => void saveDialog()}
					>
						<div className="knowledge-form">
							<input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Название" />
							<Suspense fallback={<div>Загрузка редактора…</div>}>
								<MarkdownEditor value={content} onChange={setContent} />
							</Suspense>
							{filterFields}
							{approachField}
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
						title={`${dialog.item.title}`}
						confirmLabel="Закрыть"
						onClose={() => setDialog(null)}
						onConfirm={() => setDialog(null)}
					>
						<Rating value={dialog.item.rating} readonly showValue />
						{dialog.item.approach && <p>Подход: {dialog.item.approach.name}</p>}
						<div className="knowledge-card__metadata knowledge-card__metadata--view">
							{Object.entries(storedFilters(dialog.item))
								.filter((entry): entry is [string, string] => Boolean(entry[1]))
								.map(([key, value]) => (
									<span key={key}>
										{key}: {value}
									</span>
								))}
						</div>
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
						<p>«{dialog.item.title}» будет удалён из базы знаний</p>
					</ModalDialog>
				)}
				{bulkDeleteOpen && (
					<ModalDialog
						title="Удалить выбранные элементы?"
						confirmLabel={bulkDeleting ? 'Удаление…' : `Удалить ${selectedItems.length}`}
						confirmDisabled={bulkDeleting}
						danger
						onClose={() => setBulkDeleteOpen(false)}
						onConfirm={() => void removeSelectedItems()}
					>
						<p>Выбранные элементы будут удалены из базы знаний: {selectedItems.length}</p>
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
