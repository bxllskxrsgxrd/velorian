import { useEffect, useMemo, useRef, useState } from 'react';
import {
	listDeletedConversations,
	listDeletedKnowledgeItems,
	permanentlyDeleteConversation,
	permanentlyDeleteKnowledgeItem,
	restoreConversation,
	restoreKnowledgeItem,
} from '../../api/chatApi';
import type { AuthUser, ConversationSummary } from '../../types/chat';
import {
	NewChatIcon,
	EditIcon,
	KnowledgeIcon,
	LogoutIcon,
	MoreIcon,
	SearchIcon,
	SettingsIcon,
	SidebarIcon,
	TrashIcon,
	UndoIcon,
	UserIcon,
	InfoIcon,
} from '../icons/AppIcons';
import { VelorianIcon } from '../icons/VelorianIcon';
import { ModalDialog } from '../ui/ModalDialog/ModalDialog';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import './_chatSidebar.scss';
import { SidebarButton } from '../ui/SidebarButton/SidebarButton';
import { useSidebarStore } from '../../stores/sidebarStore';
import { useConversationsStore } from '../../stores/conversationsStore';
import { useUiStore } from '../../stores/uiStore';
import { useDebounce } from '../../hooks/useDebounce';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { reportError } from '../../utils/reportError';
import { useToast } from '../../hooks/useToast';

const DAY_MS = 24 * 60 * 60 * 1000;

type TrashConfirmation = {
	type: 'chats' | 'knowledge';
	items: Array<{ id: string; title: string }>;
} | null;

function daysLabel(value: number) {
	const mod10 = value % 10;
	const mod100 = value % 100;
	if (mod10 === 1 && mod100 !== 11) return 'день';
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
	return 'дней';
}

function trashDateLabel(deletedAt?: string | null) {
	if (!deletedAt) return 'Дата удаления неизвестна';
	const isoTimestamp = deletedAt.includes('T') ? deletedAt : deletedAt.replace(' ', 'T');
	const utcTimestamp = /(?:z|[+-]\d{2}:?\d{2})$/i.test(isoTimestamp) ? isoTimestamp : `${isoTimestamp}Z`;
	const deleted = new Date(utcTimestamp);
	if (Number.isNaN(deleted.getTime())) return 'Дата удаления неизвестна';
	const now = new Date();
	const isToday =
		deleted.getFullYear() === now.getFullYear() &&
		deleted.getMonth() === now.getMonth() &&
		deleted.getDate() === now.getDate();
	const date = isToday
		? 'сегодня'
		: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(deleted);
	const time = new Intl.DateTimeFormat('ru-RU', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(deleted);
	const deleteAt = deleted.getTime() + 30 * DAY_MS;
	const remainingDays = Math.max(0, Math.floor((deleteAt - now.getTime()) / DAY_MS));
	return `Удалён ${date}, ${time} · осталось ${remainingDays} ${daysLabel(remainingDays)}`;
}

function prepareTitleMarquee(item: HTMLDivElement) {
	const title = item.querySelector<HTMLElement>('.chat-sidebar__select > span:last-child');
	if (!title) return;
	const overflow = title.scrollWidth - title.clientWidth;
	item.dataset.titleOverflowing = String(overflow > 0);
	item.style.setProperty('--chat-title-marquee-distance', `${-overflow}px`);
	item.style.setProperty('--chat-title-marquee-duration', `${Math.max(3, overflow / 30)}s`);
}

type ChatSidebarProps = {
	user: AuthUser;
	activeConversationId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
	onRename: (conversation: ConversationSummary, title: string) => void;
	onLogout: () => void;
	onOpenKnowledge: () => void;
	onOpenSettings: () => void;
	activeSection?: 'chat' | 'knowledge';
};

export function ChatSidebar(props: ChatSidebarProps) {
	const { showToast } = useToast();
	const allConversations = useConversationsStore((state) => state.conversations);
	const deletedConversations = useConversationsStore((state) => state.deletedConversations);
	const setDeletedConversations = useConversationsStore((state) => state.setDeletedConversations);
	const upsertConversation = useConversationsStore((state) => state.upsertConversation);
	const removeDeletedConversation = useConversationsStore((state) => state.removeDeletedConversation);
	const deletedKnowledgeItems = useKnowledgeStore((state) => state.deletedItems);
	const setDeletedKnowledgeItems = useKnowledgeStore((state) => state.setDeletedItems);
	const upsertKnowledgeItem = useKnowledgeStore((state) => state.upsertItem);
	const removeDeletedKnowledgeItem = useKnowledgeStore((state) => state.removeDeletedItem);
	const search = useConversationsStore((state) => state.search);
	const setSearch = useConversationsStore((state) => state.setSearch);
	const isOpen = useUiStore((state) => state.isSidebarOpen);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const isCollapsed = useUiStore((state) => state.isSidebarCollapsed);
	const toggleCollapsed = useUiStore((state) => state.toggleSidebarCollapsed);
	const conversationMenuId = useSidebarStore((state) => state.conversationMenuId);
	const setConversationMenuId = useSidebarStore((state) => state.setConversationMenuId);
	const accountOpen = useSidebarStore((state) => state.isAccountOpen);
	const setAccountOpen = useSidebarStore((state) => state.setAccountOpen);
	const dialog = useSidebarStore((state) => state.dialog);
	const setDialog = useSidebarStore((state) => state.setDialog);
	const draftTitle = useSidebarStore((state) => state.draftTitle);
	const setDraftTitle = useSidebarStore((state) => state.setDraftTitle);
	const openSidebarDialog = useSidebarStore((state) => state.openDialog);
	const closeMenus = useSidebarStore((state) => state.closeMenus);
	const sidebarRef = useRef<HTMLElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [trashOpen, setTrashOpen] = useState(false);
	const [trashTab, setTrashTab] = useState<'chats' | 'knowledge'>('chats');
	const [trashLoading, setTrashLoading] = useState(false);
	const [trashBusyId, setTrashBusyId] = useState<string | null>(null);
	const [trashError, setTrashError] = useState<string | null>(null);
	const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(() => new Set());
	const [trashConfirmation, setTrashConfirmation] = useState<TrashConfirmation>(null);
	const debouncedSearch = useDebounce(search, 250);
	const conversations = useMemo(() => {
		const query = debouncedSearch.trim().toLocaleLowerCase('ru');
		return query
			? allConversations.filter((item) => item.title.toLocaleLowerCase('ru').includes(query))
			: allConversations;
	}, [allConversations, debouncedSearch]);

	useEffect(() => {
		function handleOutsideClick(event: MouseEvent) {
			if (!sidebarRef.current?.contains(event.target as Node)) {
				closeMenus();
			}
		}
		document.addEventListener('mousedown', handleOutsideClick);
		return () => document.removeEventListener('mousedown', handleOutsideClick);
	}, [closeMenus]);

	useEffect(() => {
		if (!trashOpen) return;
		function handleEscape(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			if (trashConfirmation) setTrashConfirmation(null);
			else {
				setTrashOpen(false);
				setSelectedTrashIds(new Set());
			}
		}
		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, [trashConfirmation, trashOpen]);

	function openDialog(type: 'rename' | 'delete', conversation: ConversationSummary) {
		openSidebarDialog(type, conversation);
	}

	const currentChat = allConversations.find((conversation) => conversation.id === props.activeConversationId);

	useEffect(() => {
		document.title = currentChat?.title ?? 'Velorian';

		return () => {
			document.title = 'Velorian';
		};
	}, [currentChat?.title]);

	function openCollapsedSearch() {
		toggleCollapsed();
		requestAnimationFrame(() => searchInputRef.current?.focus());
	}

	async function openTrash() {
		setAccountOpen(false);
		setTrashOpen(true);
		setTrashLoading(true);
		setTrashError(null);
		setSelectedTrashIds(new Set());
		const [chatsResult, knowledgeResult] = await Promise.allSettled([
			listDeletedConversations(),
			listDeletedKnowledgeItems(),
		]);
		if (chatsResult.status === 'fulfilled') setDeletedConversations(chatsResult.value);
		if (knowledgeResult.status === 'fulfilled') setDeletedKnowledgeItems(knowledgeResult.value);
		if (chatsResult.status === 'rejected' || knowledgeResult.status === 'rejected') {
			const error =
				chatsResult.status === 'rejected'
					? chatsResult.reason
					: knowledgeResult.status === 'rejected'
						? knowledgeResult.reason
						: null;
			reportError('UNIFIED_TRASH_LOAD_FAILED', error);
			setTrashError(error instanceof Error ? error.message : 'Не удалось полностью загрузить корзину');
		}
		setTrashLoading(false);
	}

	function removeSelectedTrashIds(ids: string[]) {
		setSelectedTrashIds((current) => {
			const next = new Set(current);
			ids.forEach((id) => next.delete(id));
			return next;
		});
	}

	async function handleRestoreItems(type: 'chats' | 'knowledge', ids: string[]) {
		if (ids.length === 0) return;
		setTrashBusyId(`${type}:selected`);
		setTrashError(null);
		try {
			if (type === 'chats') {
				const results = await Promise.allSettled(ids.map((id) => restoreConversation(id)));
				const restoredIds: string[] = [];
				results.forEach((result, index) => {
					if (result.status !== 'fulfilled') return;
					removeDeletedConversation(ids[index]);
					upsertConversation(result.value);
					restoredIds.push(ids[index]);
				});
				removeSelectedTrashIds(restoredIds);
				const failed = results.find((result) => result.status === 'rejected');
				if (failed?.status === 'rejected') throw failed.reason;
				showToast(ids.length === 1 ? 'Чат восстановлен' : `Восстановлено чатов: ${ids.length}`, 'success');
			} else {
				const results = await Promise.allSettled(ids.map((id) => restoreKnowledgeItem(id)));
				const restoredIds: string[] = [];
				results.forEach((result, index) => {
					if (result.status !== 'fulfilled') return;
					removeDeletedKnowledgeItem(ids[index]);
					upsertKnowledgeItem(result.value);
					restoredIds.push(ids[index]);
				});
				removeSelectedTrashIds(restoredIds);
				const failed = results.find((result) => result.status === 'rejected');
				if (failed?.status === 'rejected') throw failed.reason;
				showToast(
					ids.length === 1 ? 'Запись базы знаний восстановлена' : `Восстановлено записей: ${ids.length}`,
					'success',
				);
			}
		} catch (error) {
			reportError(type === 'chats' ? 'CONVERSATION_RESTORE_FAILED' : 'KNOWLEDGE_RESTORE_FAILED', error, { ids });
			setTrashError(error instanceof Error ? error.message : 'Не удалось восстановить выбранные объекты');
		} finally {
			setTrashBusyId(null);
		}
	}

	async function handlePermanentDeleteItems(type: 'chats' | 'knowledge', ids: string[]) {
		if (ids.length === 0) return;
		setTrashBusyId(`${type}:selected`);
		setTrashError(null);
		try {
			const results = await Promise.allSettled(
				ids.map((id) =>
					type === 'chats' ? permanentlyDeleteConversation(id) : permanentlyDeleteKnowledgeItem(id),
				),
			);
			const deletedIds: string[] = [];
			results.forEach((result, index) => {
				if (result.status !== 'fulfilled') return;
				if (type === 'chats') removeDeletedConversation(ids[index]);
				else removeDeletedKnowledgeItem(ids[index]);
				deletedIds.push(ids[index]);
			});
			removeSelectedTrashIds(deletedIds);
			const failed = results.find((result) => result.status === 'rejected');
			if (failed?.status === 'rejected') throw failed.reason;
		} catch (error) {
			reportError(
				type === 'chats' ? 'CONVERSATION_PERMANENT_DELETE_FAILED' : 'KNOWLEDGE_PERMANENT_DELETE_FAILED',
				error,
				{ ids },
			);
			setTrashError(error instanceof Error ? error.message : 'Не удалось удалить выбранные объекты навсегда');
		} finally {
			setTrashBusyId(null);
		}
	}

	function closeTrash() {
		setTrashOpen(false);
		setSelectedTrashIds(new Set());
		setTrashConfirmation(null);
	}

	async function confirmTrashAction() {
		if (!trashConfirmation) return;
		await handlePermanentDeleteItems(
			trashConfirmation.type,
			trashConfirmation.items.map((item) => item.id),
		);
		setTrashConfirmation(null);
	}

	const sidebarClass = ['chat-sidebar', isOpen && 'chat-sidebar--open', isCollapsed && 'chat-sidebar--collapsed']
		.filter(Boolean)
		.join(' ');
	const activeTrashItems = trashTab === 'chats' ? deletedConversations : deletedKnowledgeItems;
	const selectedTrashItems = activeTrashItems.filter((item) => selectedTrashIds.has(item.id));
	const allTrashItemsSelected = activeTrashItems.length > 0 && selectedTrashItems.length === activeTrashItems.length;
	const someTrashItemsSelected = selectedTrashItems.length > 0 && !allTrashItemsSelected;

	return (
		<>
			<aside ref={sidebarRef} className={sidebarClass} aria-label="Навигация по чатам">
				<div className="chat-sidebar__header">
					<div className="chat-sidebar__brand">
						<button
							className="chat-sidebar__mark"
							type="button"
							onClick={isCollapsed ? toggleCollapsed : undefined}
							tabIndex={isCollapsed ? 0 : -1}
							aria-label={isCollapsed ? 'Развернуть боковую панель' : undefined}
						>
							<span className="chat-sidebar__logo">
								<VelorianIcon />
							</span>
							<span className="chat-sidebar__expand">
								<SidebarIcon />
							</span>
						</button>
						<strong>Velorian</strong>
					</div>
					<button
						className="chat-sidebar__collapse"
						type="button"
						onClick={toggleCollapsed}
						aria-label={isCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
					>
						<SidebarIcon />
					</button>
					<button
						className="chat-sidebar__mobile-close"
						type="button"
						onClick={() => setSidebarOpen(false)}
						aria-label="Закрыть меню"
					>
						×
					</button>
				</div>
				<SidebarButton icon={<NewChatIcon />} onClick={props.onNew} title="Новый чат">
					Новый чат
				</SidebarButton>
				<SidebarButton
					icon={<KnowledgeIcon />}
					active={props.activeSection === 'knowledge'}
					onClick={props.onOpenKnowledge}
					title="База знаний"
					aria-current={props.activeSection === 'knowledge' ? 'page' : undefined}
				>
					База знаний
				</SidebarButton>
				{isCollapsed && (
					<SidebarButton
						icon={<SearchIcon />}
						onClick={openCollapsedSearch}
						aria-label="Развернуть панель и найти чат"
						title="Поиск диалогов"
					/>
				)}

				<label className="chat-sidebar__search">
					<span className="chat-sidebar__visually-hidden">Поиск диалогов</span>
					<SearchIcon />
					<input
						ref={searchInputRef}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Поиск диалогов"
					/>
				</label>
				<nav className="chat-sidebar__conversations" aria-label="История диалогов">
					{conversations.length === 0 && <p className="chat-sidebar__empty">Диалогов пока нет</p>}
					{conversations.map((conversation) => (
						<div
							className={
								conversation.id === props.activeConversationId
									? 'chat-sidebar__item chat-sidebar__item--active'
									: 'chat-sidebar__item'
							}
							key={conversation.id}
							onMouseEnter={(event) => prepareTitleMarquee(event.currentTarget)}
							onMouseLeave={(event) => event.currentTarget.removeAttribute('data-title-overflowing')}
						>
							<button
								className="chat-sidebar__select"
								type="button"
								onClick={() => props.onSelect(conversation.id)}
								title={conversation.title}
							>
								<span>{conversation.title}</span>
							</button>
							<button
								className="chat-sidebar__more"
								type="button"
								onClick={() =>
									setConversationMenuId((current) => (current === conversation.id ? null : conversation.id))
								}
								aria-label={`Действия с чатом «${conversation.title}»`}
							>
								<MoreIcon />
							</button>
							{conversationMenuId === conversation.id && (
								<div className="chat-sidebar__context-menu">
									<button type="button" onClick={() => openDialog('rename', conversation)}>
										<EditIcon />
										Переименовать
									</button>
									<button
										className="chat-sidebar__danger"
										type="button"
										onClick={() => openDialog('delete', conversation)}
									>
										<TrashIcon />
										В корзину
									</button>
								</div>
							)}
						</div>
					))}
				</nav>
				<div className="chat-sidebar__account-wrap">
					{accountOpen && (
						<div className="chat-sidebar__account-menu">
							<button
								className="chat-sidebar__settings-toggle"
								type="button"
								onClick={() => {
									setAccountOpen(false);
									props.onOpenSettings();
								}}
							>
								<SettingsIcon />
								<span>Настройки</span>
							</button>
							<button type="button" onClick={() => void openTrash()}>
								<TrashIcon />
								<span>Корзина</span>
							</button>
							<button type="button" onClick={props.onLogout}>
								<LogoutIcon />
								<span>Выйти</span>
							</button>
						</div>
					)}
					<button
						className="chat-sidebar__account"
						type="button"
						onClick={() => setAccountOpen((current) => !current)}
						aria-expanded={accountOpen}
						title={props.user.email}
					>
						<span className="chat-sidebar__avatar">
							<UserIcon />
						</span>
						<span className="chat-sidebar__account-copy">
							<strong>{props.user.email.split('@')[0]}</strong>
						</span>
					</button>
				</div>
			</aside>

			{dialog?.type === 'rename' && (
				<ModalDialog
					title="Переименовать чат"
					confirmLabel="Сохранить"
					onClose={() => setDialog(null)}
					onConfirm={() => {
						const title = draftTitle.trim();
						if (title) {
							props.onRename(dialog.conversation, title);
							setDialog(null);
						}
					}}
				>
					<input
						autoFocus
						value={draftTitle}
						maxLength={160}
						onChange={(event) => setDraftTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && draftTitle.trim()) {
								props.onRename(dialog.conversation, draftTitle.trim());
								setDialog(null);
							}
						}}
					/>
				</ModalDialog>
			)}
			{dialog?.type === 'delete' && (
				<ModalDialog
					title="Переместить чат в корзину?"
					confirmLabel="Переместить в корзину"
					onClose={() => setDialog(null)}
					onConfirm={() => {
						props.onDelete(dialog.conversation.id);
						setDialog(null);
					}}
				>
					<p>Чат «{dialog.conversation.title}» будет перемещён в корзину</p>
				</ModalDialog>
			)}
			{trashOpen && (
				<ModalDialog title="Корзина" confirmLabel="Закрыть" onClose={closeTrash} onConfirm={closeTrash}>
					<div className="chat-sidebar__trash">
						<button
							className="chat-sidebar__trash-close"
							type="button"
							aria-label="Закрыть корзину"
							onClick={closeTrash}
						>
							×
						</button>
						<div className="chat-sidebar__trash-tabs" role="tablist" aria-label="Раздел корзины">
							<button
								className={
									trashTab === 'chats'
										? 'chat-sidebar__trash-tab chat-sidebar__trash-tab--active'
										: 'chat-sidebar__trash-tab'
								}
								type="button"
								role="tab"
								aria-selected={trashTab === 'chats'}
								onClick={() => {
									setTrashTab('chats');
									setSelectedTrashIds(new Set());
								}}
							>
								Чаты ({deletedConversations.length})
							</button>
							<button
								className={
									trashTab === 'knowledge'
										? 'chat-sidebar__trash-tab chat-sidebar__trash-tab--active'
										: 'chat-sidebar__trash-tab'
								}
								type="button"
								role="tab"
								aria-selected={trashTab === 'knowledge'}
								onClick={() => {
									setTrashTab('knowledge');
									setSelectedTrashIds(new Set());
								}}
							>
								База знаний ({deletedKnowledgeItems.length})
							</button>
						</div>
						<div className="chat-sidebar__info">
							<InfoIcon />
								<p className="chat-sidebar__trash-note">Объекты автоматически удаляются через 30 дней</p>
						</div>

						<div className="chat-sidebar__trash-error-slot" aria-live="polite">
							{trashError && <p className="chat-sidebar__trash-error">{trashError}</p>}
						</div>
						<div className="chat-sidebar__trash-toolbar">
							<div className="chat-sidebar__trash-toolbar-selection">
								<Checkbox
									checked={allTrashItemsSelected}
									indeterminate={someTrashItemsSelected}
									disabled={activeTrashItems.length === 0 || trashBusyId !== null}
									label="Выбрать все"
									className="chat-sidebar__trash-checkbox"
									onChange={(checked) =>
										setSelectedTrashIds(checked ? new Set(activeTrashItems.map((item) => item.id)) : new Set())
									}
								/>
								<span>Выбрано: {selectedTrashItems.length} из {activeTrashItems.length}</span>
							</div>
							<div className="chat-sidebar__trash-toolbar-actions">
								<button
									className="chat-sidebar__trash-restore-selected"
									type="button"
									aria-label={`Восстановить выбранные (${selectedTrashItems.length})`}
									disabled={selectedTrashItems.length === 0 || trashBusyId !== null}
									onClick={() =>
										void handleRestoreItems(
											trashTab,
											selectedTrashItems.map((item) => item.id),
										)
									}
								>
									<UndoIcon />
									Восстановить
								</button>
								<button
									className="chat-sidebar__trash-delete-selected"
									type="button"
									disabled={selectedTrashItems.length === 0 || trashBusyId !== null}
									onClick={() => setTrashConfirmation({ type: trashTab, items: selectedTrashItems })}
								>
									<TrashIcon />
									Удалить
								</button>
							</div>
						</div>
						<div className="chat-sidebar__trash-list-viewport" role="tabpanel">
							{trashLoading ? (
								<p className="chat-sidebar__trash-empty">Загрузка…</p>
							) : activeTrashItems.length === 0 ? (
								<p className="chat-sidebar__trash-empty">Корзина пуста</p>
							) : (
								<ul className="chat-sidebar__trash-list">
									{activeTrashItems.map((item, index) => {
										const selected = selectedTrashIds.has(item.id);
										const previousSelected = index > 0 && selectedTrashIds.has(activeTrashItems[index - 1].id);
										const nextSelected =
											index < activeTrashItems.length - 1 && selectedTrashIds.has(activeTrashItems[index + 1].id);
										const selectedPosition = !selected
											? null
											: !previousSelected && !nextSelected
												? 'single'
												: !previousSelected
													? 'start'
													: !nextSelected
														? 'end'
														: 'middle';

										return (
											<li
												key={`${trashTab}:${item.id}`}
												className={
													selectedPosition
														? `chat-sidebar__trash-row--selected chat-sidebar__trash-row--selected-${selectedPosition}`
														: undefined
												}
											>
												<Checkbox
													checked={selected}
													disabled={trashBusyId !== null}
													label={`Выбрать «${item.title}»`}
													className="chat-sidebar__trash-checkbox"
													onChange={(checked) =>
														setSelectedTrashIds((current) => {
															const next = new Set(current);
															if (checked) next.add(item.id);
															else next.delete(item.id);
															return next;
														})
													}
												/>
												<div className="chat-sidebar__trash-copy">
													<strong title={item.title}>{item.title}</strong>
													<small>{trashDateLabel(item.deletedAt)}</small>
												</div>
												<div className="chat-sidebar__trash-actions">
													<button
														className="chat-sidebar__trash-action chat-sidebar__trash-action--restore"
														type="button"
														aria-label="Восстановить"
														disabled={trashBusyId !== null}
														onClick={() => void handleRestoreItems(trashTab, [item.id])}
													>
														<UndoIcon />
													</button>
													<button
														className="chat-sidebar__trash-action chat-sidebar__trash-action--delete"
														type="button"
														aria-label="Удалить навсегда"
														disabled={trashBusyId !== null}
														onClick={() => setTrashConfirmation({ type: trashTab, items: [{ id: item.id, title: item.title }] })}
													>
														<TrashIcon />
													</button>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>
				</ModalDialog>
			)}

			{trashConfirmation && (
				<ModalDialog
					title="Удалить навсегда?"
					confirmLabel={trashBusyId ? 'Удаление…' : 'Удалить навсегда'}
					confirmDisabled={trashBusyId !== null}
					closeDisabled={trashBusyId !== null}
					danger
					onClose={() => setTrashConfirmation(null)}
					onConfirm={() => void confirmTrashAction()}
				>
					<p>
						{trashConfirmation.items.length === 1
							? `«${trashConfirmation.items[0].title}» будет удалён без возможности восстановления`
							: `${trashConfirmation.items.length} выбранных объектов будут удалены без возможности восстановления`}
					</p>
				</ModalDialog>
			)}
		</>
	);
}
