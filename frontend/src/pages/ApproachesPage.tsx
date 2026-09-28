import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BurgerIcon, ListIcon, MoveIcon } from '../components/icons/AppIcons';
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
	const [sort, setSort] = useState<ApproachSortMode>('name_asc');
	const cardMenuRef = useRef<HTMLDivElement>(null);
	const cardCursorIndicatorRef = useRef<HTMLDivElement>(null);
	const cardCursorPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const cardCursorTimerRef = useRef<number | null>(null);
	const cardMenuItem = cardMenu ? items.find((item) => item.id === cardMenu.itemId) : null;
	const deleteItem = deleteItemId ? items.find((item) => item.id === deleteItemId) : null;
	const displayedItems = useMemo(() => {
		if (sort === 'name_asc') return items;
		return [...items].sort((left, right) => {
			if (left.rating == null) return right.rating == null ? 0 : 1;
			if (right.rating == null) return -1;
			const difference = sort === 'rating_desc' ? right.rating - left.rating : left.rating - right.rating;
			return difference || left.name.localeCompare(right.name, 'ru');
		});
	}, [items, sort]);

	useEffect(() => {
		void load().catch((error: unknown) => {
			reportError('APPROACHES_LOAD_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось загрузить подходы', 'error');
		});
	}, [load, showToast]);

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
			<div className="approaches-page__controls">
				<label>
					Сортировка
					<CustomSelect
						value={sort}
						onChange={(value) => setSort(value as ApproachSortMode)}
						ariaLabel="Сортировка подходов"
						options={[
							{ value: 'name_asc', label: 'По названию' },
							{ value: 'rating_desc', label: 'Сначала высокий рейтинг' },
							{ value: 'rating_asc', label: 'Сначала низкий рейтинг' },
						]}
					/>
				</label>
			</div>
			<section className="approaches-page__list">
				{loading && <p>Загрузка…</p>}
				{!loading && items.length === 0 && <p>Подходов пока нет</p>}
				{displayedItems.map((item) => (
					<article
						className={`knowledge-card approach-card ${!item.isActive ? 'knowledge-card--inactive' : ''}`}
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
		</main>
	);
}
