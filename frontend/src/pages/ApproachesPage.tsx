import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BurgerIcon, ListIcon, MoveIcon, SearchIcon } from '../components/icons/AppIcons';
import { BulkSelectionBar } from '../components/BulkSelectionBar/BulkSelectionBar';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { CustomSelect } from '../components/ui/CustomSelect/CustomSelect';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Rating } from '../components/ui/Rating/Rating';
import { KnowledgeCardMetadata } from '../components/KnowledgeCardMetadata/KnowledgeCardMetadata';
import { useToast } from '../hooks/useToast';
import { useApproachesStore } from '../stores/approachesStore';
import { useUiStore } from '../stores/uiStore';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';
import './_approaches.scss';
import { Button } from '../components/ui/Button/Button';

type ApproachCardMenuState = { itemId: string; top: number; left: number };
type ApproachSortMode = 'name_asc' | 'rating_desc' | 'rating_asc';
type ApproachRatingFilter = 'all' | '5' | '4' | '3' | 'unrated';

export function ApproachesPage() {
	const navigate = useNavigate();
	const items = useApproachesStore((state) => state.items);
	const loading = useApproachesStore((state) => state.isLoading);
	const load = useApproachesStore((state) => state.load);
	const update = useApproachesStore((state) => state.update);
	const remove = useApproachesStore((state) => state.delete);
	const saving = useApproachesStore((state) => state.isSaving);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const { showToast } = useToast();
	const [cardMenu, setCardMenu] = useState<ApproachCardMenuState | null>(null);
	const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
	const [activeDropdown, setActiveDropdown] = useState<'filters' | 'sort' | null>(null);
	const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	const [bulkDeleting, setBulkDeleting] = useState(false);
	const [search, setSearch] = useState('');
	const [activeFilter, setActiveFilter] = useState('all');
	const [ratingFilter, setRatingFilter] = useState<ApproachRatingFilter>('all');
	const [sort, setSort] = useState<ApproachSortMode>('name_asc');
	const dropdownRef = useRef<HTMLElement>(null);
	const cardMenuRef = useRef<HTMLDivElement>(null);
	const cardCursorIndicatorRef = useRef<HTMLDivElement>(null);
	const cardCursorPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const cardCursorTimerRef = useRef<number | null>(null);
	const cardMenuItem = cardMenu ? items.find((item) => item.id === cardMenu.itemId) : null;
	const deleteItem = deleteItemId ? items.find((item) => item.id === deleteItemId) : null;
	const displayedItems = useMemo(() => {
		const normalizedSearch = search.trim().toLocaleLowerCase('ru');
		const filteredItems = items.filter((item) => {
			if (normalizedSearch && !`${item.name} ${item.description}`.toLocaleLowerCase('ru').includes(normalizedSearch)) {
				return false;
			}
			if (activeFilter !== 'all' && item.isActive !== (activeFilter === 'active')) return false;
			if (ratingFilter === 'unrated') return item.rating == null;
			if (ratingFilter !== 'all' && (item.rating == null || item.rating < Number(ratingFilter))) return false;
			return true;
		});
		if (sort === 'name_asc') return filteredItems;
		return [...filteredItems].sort((left, right) => {
			if (left.rating == null) return right.rating == null ? 0 : 1;
			if (right.rating == null) return -1;
			const difference = sort === 'rating_desc' ? right.rating - left.rating : left.rating - right.rating;
			return difference || left.name.localeCompare(right.name, 'ru');
		});
	}, [activeFilter, items, ratingFilter, search, sort]);
	const selectedItems = useMemo(
		() => displayedItems.filter((item) => selectedItemIds.has(item.id)),
		[displayedItems, selectedItemIds],
	);
	const activeFiltersCount = Number(activeFilter !== 'all') + Number(ratingFilter !== 'all');

	useEffect(() => {
		void load().catch((error: unknown) => {
			reportError('APPROACHES_LOAD_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось загрузить подходы', 'error');
		});
	}, [load, showToast]);

	useEffect(() => {
		if (!activeDropdown) return;
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setActiveDropdown(null);
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setActiveDropdown(null);
		}
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [activeDropdown]);

	useEffect(() => {
		if (!cardMenu) return;
		function handleClickOutside(event: MouseEvent) {
			if (!cardMenuRef.current?.contains(event.target as Node)) setCardMenu(null);
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setCardMenu(null);
		}
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [cardMenu]);

	useEffect(
		() => () => {
			if (cardCursorTimerRef.current !== null) window.clearTimeout(cardCursorTimerRef.current);
		},
		[],
	);

	function hideCardCursorIndicator() {
		if (cardCursorTimerRef.current !== null) window.clearTimeout(cardCursorTimerRef.current);
		cardCursorTimerRef.current = null;
		cardCursorPositionRef.current = null;
		if (cardCursorIndicatorRef.current) {
			cardCursorIndicatorRef.current.style.transform = 'translate3d(-100px, -100px, 0)';
		}
	}

	function updateCardCursorIndicator(target: EventTarget | null, clientX: number, clientY: number) {
		const indicator = cardCursorIndicatorRef.current;
		const interactiveTarget = target instanceof Element && target.closest('button, a, input, label');
		hideCardCursorIndicator();
		if (!indicator || interactiveTarget || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

		cardCursorPositionRef.current = { clientX, clientY };
		cardCursorTimerRef.current = window.setTimeout(() => {
			cardCursorTimerRef.current = null;
			const position = cardCursorPositionRef.current;
			if (!position || !cardCursorIndicatorRef.current) return;
			const indicatorSize = 16;
			const viewportInset = 6;
			const x = Math.max(
				viewportInset,
				Math.min(position.clientX + 10, window.innerWidth - indicatorSize - viewportInset),
			);
			const y = Math.max(
				viewportInset,
				Math.min(position.clientY + 10, window.innerHeight - indicatorSize - viewportInset),
			);
			cardCursorIndicatorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		}, 400);
	}

	function openCardMenu(itemId: string, left: number, top: number) {
		setCardMenu({
			itemId,
			left: Math.max(8, Math.min(left, window.innerWidth - 228)),
			top: Math.max(8, Math.min(top, window.innerHeight - 112)),
		});
	}

	function runCardMenuAction(action: () => void) {
		setCardMenu(null);
		action();
	}

	async function toggleApproach(itemId: string, isActive: boolean) {
		try {
			await update(itemId, { isActive });
		} catch (error) {
			reportError('APPROACH_UPDATE_FAILED', error, { itemId });
			showToast(error instanceof Error ? error.message : 'Не удалось изменить состояние подхода', 'error');
		}
	}

	async function rateApproach(itemId: string, rating: number | null) {
		try {
			await update(itemId, { rating });
		} catch (error) {
			reportError('APPROACH_RATING_UPDATE_FAILED', error, { itemId });
			showToast(error instanceof Error ? error.message : 'Не удалось изменить рейтинг подхода', 'error');
		}
	}

	async function deleteApproach() {
		if (!deleteItem) return;
		try {
			await remove(deleteItem.id);
			setDeleteItemId(null);
		} catch (error) {
			reportError('APPROACH_DELETE_FAILED', error, { itemId: deleteItem.id });
			showToast(error instanceof Error ? error.message : 'Не удалось удалить подход', 'error');
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

	function resetSelection() {
		setSelectedItemIds(new Set());
	}

	async function removeSelectedApproaches() {
		if (selectedItems.length === 0 || bulkDeleting) return;
		setBulkDeleting(true);
		const results = await Promise.allSettled(selectedItems.map((item) => remove(item.id)));
		const succeededIds = new Set<string>();
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') succeededIds.add(selectedItems[index].id);
		});
		setSelectedItemIds((current) => new Set([...current].filter((id) => !succeededIds.has(id))));
		const failedCount = results.length - succeededIds.size;
		showToast(
			failedCount > 0
				? `Обработано подходов: ${succeededIds.size}. Не удалось удалить: ${failedCount}`
				: `Обработано подходов: ${succeededIds.size}`,
			failedCount > 0 ? 'error' : 'success',
		);
		setBulkDeleting(false);
		setBulkDeleteOpen(false);
	}		

	return (
		<main className="approaches-page knowledge-page">
			<header>
				<div>
					<div className="approaches-page__navigation">
						<button className="knowledge-page__mobile-menu" type="button" onClick={() => setSidebarOpen(true)}>
							<BurgerIcon />
						</button>
						<button className="approaches-page__back" type="button" onClick={() => navigate('/knowledge')}>
							<MoveIcon /> База знаний
						</button>
					</div>
					<h1>Подходы</h1>
					<p>Глобальные профили, которыми руководствуется агент</p>
				</div>
				<Button variant="filled" tone="accent" size="medium" onClick={() => navigate('/knowledge/approaches/new')}>
					Создать подход
				</Button>
			</header>
			<section className="knowledge-page__controls" aria-label="Управление подходами" ref={dropdownRef}>
				<div className="knowledge-page__search-row">
					<div className="knowledge-page__search">
						<SearchIcon className="knowledge-page__search-icon" />
						<input
							className="knowledge-page__search-input"
							value={search}
							onChange={(event) => {
								setSearch(event.target.value);
								resetSelection();
							}}
							placeholder="Поиск по названию и описанию"
							aria-label="Поиск по подходам"
						/>
					</div>
					<Button
						variant="outline"
						tone="neutral"
						size="medium"
						aria-expanded={activeDropdown === 'filters'}
						onClick={() => setActiveDropdown(activeDropdown === 'filters' ? null : 'filters')}
					>
						Фильтры
						{activeFiltersCount > 0 && <span className="button__count">{activeFiltersCount}</span>}
					</Button>
					<Button
						variant="outline"
						tone="neutral"
						size="medium"
						aria-expanded={activeDropdown === 'sort'}
						onClick={() => setActiveDropdown(activeDropdown === 'sort' ? null : 'sort')}
					>
						Сортировка
					</Button>
				</div>
				{activeDropdown === 'filters' && (
					<div className="knowledge-page__dropdown knowledge-page__dropdown--filters">
						<div className="knowledge-page__dropdown-grid">
							<label>
								Рейтинг
								<CustomSelect
									value={ratingFilter}
									onChange={(value) => {
										setRatingFilter(value as ApproachRatingFilter);
										resetSelection();
									}}
									ariaLabel="Рейтинг подходов"
									options={[
										{ value: 'all', label: 'Все рейтинги' },
										{ value: '5', label: '5 из 5' },
										{ value: '4', label: '4 и выше' },
										{ value: '3', label: '3 и выше' },
										{ value: 'unrated', label: 'Без рейтинга' },
									]}
								/>
							</label>
							<label>
								Состояние
								<CustomSelect
									value={activeFilter}
									onChange={(value) => {
										setActiveFilter(value);
										resetSelection();
									}}
									ariaLabel="Состояние подходов"
									options={[
										{ value: 'all', label: 'Все состояния' },
										{ value: 'active', label: 'Активные' },
										{ value: 'inactive', label: 'Неактивные' },
									]}
								/>
							</label>
						</div>
						<div className="knowledge-page__dropdown-actions">
							<button
								className="knowledge-page__reset-small"
								type="button"
								disabled={activeFiltersCount === 0}
								onClick={() => {
									setRatingFilter('all');
									setActiveFilter('all');
									resetSelection();
								}}
							>
								Сбросить
							</button>
						</div>
					</div>
				)}
				{activeDropdown === 'sort' && (
					<div className="knowledge-page__dropdown knowledge-page__dropdown--sort">
						{[
							{ value: 'name_asc' as const, label: 'По названию' },
							{ value: 'rating_desc' as const, label: 'Рейтинг: высокий' },
							{ value: 'rating_asc' as const, label: 'Рейтинг: низкий' },
						].map((option) => (
							<button
								key={option.value}
								className={`knowledge-page__sort-option ${sort === option.value ? 'active' : ''}`}
								type="button"
								onClick={() => {
									setSort(option.value);
									setActiveDropdown(null);
									resetSelection();
								}}
							>
								{option.label}
							</button>
						))}
					</div>
				)}
			</section>
			<BulkSelectionBar
				selectedCount={selectedItems.length}
				totalCount={displayedItems.length}
				onSelectAll={() => setSelectedItemIds(new Set(displayedItems.map((item) => item.id)))}
				onClear={resetSelection}
				onDelete={() => setBulkDeleteOpen(true)}
				deleteLabel={`Удалить ${selectedItems.length}`}
				ariaLabel="Действия с выбранными подходами"
			/>
			<section className="knowledge-page__list">
				{loading && <p className="knowledge-page__empty">Загрузка…</p>}
				{!loading && displayedItems.length === 0 && (
					<p className="knowledge-page__empty">{items.length === 0 ? 'Подходов пока нет' : 'Подходы не найдены'}</p>
				)}
				{!loading && displayedItems.map((item) => (
					<article
						className={`knowledge-card approach-card ${selectedItemIds.has(item.id) ? 'knowledge-card--selected' : ''} ${!item.isActive ? 'knowledge-card--inactive' : ''}`}
						key={item.id}
						onMouseEnter={(event) => updateCardCursorIndicator(event.target, event.clientX, event.clientY)}
						onMouseMove={(event) => updateCardCursorIndicator(event.target, event.clientX, event.clientY)}
						onMouseLeave={hideCardCursorIndicator}
						onContextMenu={(event) => {
							hideCardCursorIndicator();
							if ((event.target as HTMLElement).closest('button, a, input, label')) return;
							event.preventDefault();
							openCardMenu(item.id, event.clientX, event.clientY);
						}}
					>
						<div className="knowledge-card__select-column">
							<Checkbox
								checked={selectedItemIds.has(item.id)}
								onChange={(checked) => toggleSelectedItem(item.id, checked)}
								label={`Выбрать ${item.name}`}
								className="knowledge-card__select"
							/>
						</div>
						<div className="knowledge-card__content">
							<div className="knowledge-card__head">
								<div>
									<strong>{item.name}</strong>
									<Rating
										value={item.rating}
										onChange={(rating) => void rateApproach(item.id, rating)}
										disabled={saving}
										size="small"
										ariaLabel={`Рейтинг подхода ${item.name}`}
									/>
									<KnowledgeCardMetadata createdAt={item.createdAt} updatedAt={item.updatedAt} />
								</div>
								<Checkbox
									checked={item.isActive}
									disabled={saving}
									onChange={(isActive) => void toggleApproach(item.id, isActive)}
									label="Подход активен"
									className="knowledge-card__active-toggle"
								/>
							</div>
							<p>{item.description || 'Описание не заполнено'}</p>
							<small className="approach-card__linked-count">
								Связанных материалов: {item.linkedKnowledgeItemsCount ?? 0}
							</small>
						</div>
					</article>
				))}
			</section>
			{createPortal(
				<div ref={cardCursorIndicatorRef} className="knowledge-card__cursor-indicator" aria-hidden="true">
					<ListIcon />
				</div>,
				document.body,
			)}
			{cardMenu && cardMenuItem && (
				<div
					ref={cardMenuRef}
					className="knowledge-card__menu"
					role="menu"
					aria-label={`Действия с подходом «${cardMenuItem.name}»`}
					style={{ top: cardMenu.top, left: cardMenu.left }}
				>
					<button
						type="button"
						role="menuitem"
						onClick={() => runCardMenuAction(() => navigate(`/knowledge/approaches/${cardMenuItem.id}`))}
					>
						Редактировать
					</button>
					<div className="knowledge-card__menu-separator" role="separator" />
					<button
						className="knowledge-card__menu-delete"
						type="button"
						role="menuitem"
						onClick={() => runCardMenuAction(() => setDeleteItemId(cardMenuItem.id))}
					>
						Удалить
					</button>
				</div>
			)}
			{deleteItem && (
				<ModalDialog
					title="Удалить подход?"
					confirmLabel="Удалить"
					danger
					onClose={() => setDeleteItemId(null)}
					onConfirm={() => void deleteApproach()}
				>
					<p>Если подход используется, он будет деактивирован и связи материалов сохранятся</p>
				</ModalDialog>
			)}
			{bulkDeleteOpen && (
				<ModalDialog
					title="Удалить выбранные подходы?"
					confirmLabel={bulkDeleting ? 'Удаление…' : 'Удалить'}
					confirmDisabled={bulkDeleting}
					danger
					onClose={() => setBulkDeleteOpen(false)}
					onConfirm={() => void removeSelectedApproaches()}
				>
					<p>
						Подходы без связанных материалов будут удалены. Остальные будут деактивированы: {selectedItems.length}
					</p>
				</ModalDialog>
			)}
		</main>
	);
}
