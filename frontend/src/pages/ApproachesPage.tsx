import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BurgerIcon, ListIcon, MoveIcon } from '../components/icons/AppIcons';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { useToast } from '../hooks/useToast';
import { useApproachesStore } from '../stores/approachesStore';
import { useUiStore } from '../stores/uiStore';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';
import './_approaches.scss';
import { Button } from '../components/ui/Button/Button';

type ApproachCardMenuState = { itemId: string; top: number; left: number };

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
	const cardMenuRef = useRef<HTMLDivElement>(null);
	const cardCursorIndicatorRef = useRef<HTMLDivElement>(null);
	const cardCursorPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const cardCursorTimerRef = useRef<number | null>(null);
	const cardMenuItem = cardMenu ? items.find((item) => item.id === cardMenu.itemId) : null;
	const deleteItem = deleteItemId ? items.find((item) => item.id === deleteItemId) : null;

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
			<section className="approaches-page__list">
				{loading && <p>Загрузка…</p>}
				{!loading && items.length === 0 && <p>Подходов пока нет</p>}
				{items.map((item) => (
					<article
						className="approach-card"
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
						<strong className="approach-card__head">{item.name}</strong>

						<span className="approach-card__description">
							<span className="approach-card__description--text">{item.description || 'Описание не заполнено'}</span>

							<Checkbox
								checked={item.isActive}
								disabled={saving}
								onChange={(isActive) => void toggleApproach(item.id, isActive)}
								label="Подход активен"
								className="approach-card__active-toggle"
							/>
						</span>
						<small>Связанных материалов: {item.linkedKnowledgeItemsCount ?? 0}</small>
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
