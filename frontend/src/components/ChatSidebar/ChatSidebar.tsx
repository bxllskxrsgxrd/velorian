import { useEffect, useMemo, useRef, useState } from 'react';
import {
	emptyConversationTrash,
	emptyKnowledgeTrash,
	listDeletedConversations,
	listDeletedKnowledgeItems,
	permanentlyDeleteConversation,
	permanentlyDeleteKnowledgeItem,
	restoreConversation,
	restoreKnowledgeItem,
} from '../../api/chatApi';
import { ACCENT_THEMES, ACCENT_THEME_LABELS, type AccentTheme } from '../../theme/accentTheme';
import type { AuthUser, ConversationSummary } from '../../types/chat';
import {
	NewChatIcon,
	ChevronIcon,
	EditIcon,
	KnowledgeIcon,
	LogoutIcon,
	MoreIcon,
	SearchIcon,
	SettingsIcon,
	SidebarIcon,
	TrashIcon,
	UserIcon,
} from '../icons/AppIcons';
import { VelorianIcon } from '../icons/VelorianIcon';
import { ModalDialog } from '../ui/ModalDialog/ModalDialog';
import './_chatSidebar.scss';
import { SidebarButton } from '../ui/SidebarButton/SidebarButton';
import { useSidebarStore } from '../../stores/sidebarStore';
import { useConversationsStore } from '../../stores/conversationsStore';
import { useUiStore } from '../../stores/uiStore';
import { useDebounce } from '../../hooks/useDebounce';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { reportError } from '../../utils/reportError';

type ChatSidebarProps = {
	user: AuthUser;
	activeConversationId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
	onRename: (conversation: ConversationSummary, title: string) => void;
	onExport: (format: 'markdown' | 'json') => void;
	onLogout: () => void;
	onOpenKnowledge: () => void;
	activeSection?: 'chat' | 'knowledge';
};

export function ChatSidebar(props: ChatSidebarProps) {
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
	const accentTheme = useUiStore((state) => state.accent);
	const setAccent = useUiStore((state) => state.setAccent);
	const isOpen = useUiStore((state) => state.isSidebarOpen);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const isCollapsed = useUiStore((state) => state.isSidebarCollapsed);
	const toggleCollapsed = useUiStore((state) => state.toggleSidebarCollapsed);
	const conversationMenuId = useSidebarStore((state) => state.conversationMenuId);
	const setConversationMenuId = useSidebarStore((state) => state.setConversationMenuId);
	const accountOpen = useSidebarStore((state) => state.isAccountOpen);
	const setAccountOpen = useSidebarStore((state) => state.setAccountOpen);
	const settingsOpen = useSidebarStore((state) => state.isSettingsOpen);
	const setSettingsOpen = useSidebarStore((state) => state.setSettingsOpen);
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
		setSettingsOpen(false);
		setTrashOpen(true);
		setTrashLoading(true);
		setTrashError(null);
		const [chatsResult, knowledgeResult] = await Promise.allSettled([
			listDeletedConversations(),
			listDeletedKnowledgeItems(),
		]);
		if (chatsResult.status === 'fulfilled') setDeletedConversations(chatsResult.value);
		if (knowledgeResult.status === 'fulfilled') setDeletedKnowledgeItems(knowledgeResult.value);
		if (chatsResult.status === 'rejected' || knowledgeResult.status === 'rejected') {
			const error = chatsResult.status === 'rejected' ? chatsResult.reason : knowledgeResult.status === 'rejected' ? knowledgeResult.reason : null;
			reportError('UNIFIED_TRASH_LOAD_FAILED', error);
			setTrashError(error instanceof Error ? error.message : 'Не удалось полностью загрузить корзину');
		}
		setTrashLoading(false);
	}

	async function handleRestoreChat(conversationId: string) {
		setTrashBusyId(`chat:${conversationId}`);
		setTrashError(null);
		try {
			const restored = await restoreConversation(conversationId);
			removeDeletedConversation(conversationId);
			upsertConversation(restored);
		} catch (error) {
			reportError('CONVERSATION_RESTORE_FAILED', error, { conversationId });
			setTrashError(error instanceof Error ? error.message : 'Не удалось восстановить чат');
		} finally {
			setTrashBusyId(null);
		}
	}

	async function handlePermanentChatDelete(conversationId: string) {
		setTrashBusyId(`chat:${conversationId}`);
		setTrashError(null);
		try {
			await permanentlyDeleteConversation(conversationId);
			removeDeletedConversation(conversationId);
		} catch (error) {
			reportError('CONVERSATION_PERMANENT_DELETE_FAILED', error, { conversationId });
			setTrashError(error instanceof Error ? error.message : 'Не удалось удалить чат навсегда');
		} finally {
			setTrashBusyId(null);
		}
	}

	async function handleEmptyChatTrash() {
		setTrashBusyId('chat:all');
		setTrashError(null);
		try {
			await emptyConversationTrash();
			setDeletedConversations([]);
		} catch (error) {
			reportError('CONVERSATION_TRASH_EMPTY_FAILED', error);
			setTrashError(error instanceof Error ? error.message : 'Не удалось очистить корзину чатов');
		} finally {
			setTrashBusyId(null);
		}
	}

	async function handleRestoreKnowledge(itemId: string) {
		setTrashBusyId(`knowledge:${itemId}`);
		setTrashError(null);
		try {
			const restored = await restoreKnowledgeItem(itemId);
			removeDeletedKnowledgeItem(itemId);
			upsertKnowledgeItem(restored);
		} catch (error) {
			reportError('KNOWLEDGE_RESTORE_FAILED', error, { itemId });
			setTrashError(error instanceof Error ? error.message : 'Не удалось восстановить запись');
		} finally {
			setTrashBusyId(null);
		}
	}

	async function handlePermanentKnowledgeDelete(itemId: string) {
		setTrashBusyId(`knowledge:${itemId}`);
		setTrashError(null);
		try {
			await permanentlyDeleteKnowledgeItem(itemId);
			removeDeletedKnowledgeItem(itemId);
		} catch (error) {
			reportError('KNOWLEDGE_PERMANENT_DELETE_FAILED', error, { itemId });
			setTrashError(error instanceof Error ? error.message : 'Не удалось удалить запись навсегда');
		} finally {
			setTrashBusyId(null);
		}
	}

	async function handleEmptyKnowledgeTrash() {
		setTrashBusyId('knowledge:all');
		setTrashError(null);
		try {
			await emptyKnowledgeTrash();
			setDeletedKnowledgeItems([]);
		} catch (error) {
			reportError('KNOWLEDGE_TRASH_EMPTY_FAILED', error);
			setTrashError(error instanceof Error ? error.message : 'Не удалось очистить корзину БД');
		} finally {
			setTrashBusyId(null);
		}
	}

	const sidebarClass = [
		'chat-sidebar',
		isOpen && 'chat-sidebar--open',
		isCollapsed && 'chat-sidebar--collapsed',
	]
		.filter(Boolean)
		.join(' ');

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
										Удалить
									</button>
								</div>
							)}
						</div>
					))}
				</nav>
				<div className="chat-sidebar__account-wrap">
					{accountOpen && (
						<div className="chat-sidebar__account-menu">
							<button type="button" onClick={() => setSettingsOpen((current) => !current)}>
								<SettingsIcon />
								<span>Настройки</span>
								<ChevronIcon />
							</button>
							{settingsOpen && (
								<div className="chat-sidebar__settings-panel">
									<label>
										<span>Акцент интерфейса</span>
										<select
											value={accentTheme}
											onChange={(event) => setAccent(event.target.value as AccentTheme)}
										>
											{ACCENT_THEMES.map((theme) => (
												<option value={theme} key={theme}>
													{ACCENT_THEME_LABELS[theme]}
												</option>
											))}
										</select>
									</label>
									<div>
										<button type="button" onClick={() => props.onExport('markdown')}>
											Экспорт .md
										</button>
										<button type="button" onClick={() => props.onExport('json')}>
											Экспорт .json
										</button>
									</div>
								</div>
							)}
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
							<small>{props.user.email}</small>
						</span>
						<MoreIcon />
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
					title="Удалить чат?"
					confirmLabel="Удалить"
					danger
					onClose={() => setDialog(null)}
					onConfirm={() => {
						props.onDelete(dialog.conversation.id);
						setDialog(null);
					}}
				>
					<p>Чат «{dialog.conversation.title}» будет перемещён в корзину.</p>
				</ModalDialog>
			)}
			{trashOpen && (
				<ModalDialog
					title="Корзина"
					confirmLabel="Закрыть"
					onClose={() => setTrashOpen(false)}
					onConfirm={() => setTrashOpen(false)}
				>
					<div className="chat-sidebar__trash">
						<div className="chat-sidebar__trash-tabs" role="tablist" aria-label="Раздел корзины">
							<button
								className={trashTab === 'chats' ? 'chat-sidebar__trash-tab chat-sidebar__trash-tab--active' : 'chat-sidebar__trash-tab'}
								type="button"
								role="tab"
								aria-selected={trashTab === 'chats'}
								onClick={() => setTrashTab('chats')}
							>
								Корзина чатов ({deletedConversations.length})
							</button>
							<button
								className={trashTab === 'knowledge' ? 'chat-sidebar__trash-tab chat-sidebar__trash-tab--active' : 'chat-sidebar__trash-tab'}
								type="button"
								role="tab"
								aria-selected={trashTab === 'knowledge'}
								onClick={() => setTrashTab('knowledge')}
							>
								Корзина БД ({deletedKnowledgeItems.length})
							</button>
						</div>
						<p className="chat-sidebar__trash-note">Удаление навсегда выполняется через 30 суток после перемещения в корзину.</p>
						{trashError && <p className="chat-sidebar__trash-error">{trashError}</p>}
						{trashLoading ? (
							<p className="chat-sidebar__trash-empty">Загрузка…</p>
						) : trashTab === 'chats' ? (
							<div className="chat-sidebar__trash-pane" role="tabpanel">
								<div className="chat-sidebar__trash-toolbar">
									<button
										className="chat-sidebar__trash-danger"
										type="button"
										disabled={deletedConversations.length === 0 || trashBusyId !== null}
										onClick={() => void handleEmptyChatTrash()}
									>
										<TrashIcon /> Очистить корзину
									</button>
								</div>
								{deletedConversations.length === 0 ? <p className="chat-sidebar__trash-empty">Удалённых чатов нет</p> : (
									<ul className="chat-sidebar__trash-list">
										{deletedConversations.map((conversation) => (
											<li key={conversation.id}>
												<div className="chat-sidebar__trash-copy">
													<strong>{conversation.title}</strong>
													{conversation.deletedAt && <small>Удалён {new Date(conversation.deletedAt).toLocaleString('ru-RU')}</small>}
												</div>
												<div className="chat-sidebar__trash-actions">
													<button type="button" disabled={trashBusyId !== null} onClick={() => void handleRestoreChat(conversation.id)}>Восстановить</button>
													<button className="chat-sidebar__trash-danger" type="button" disabled={trashBusyId !== null} onClick={() => void handlePermanentChatDelete(conversation.id)}><TrashIcon /> Удалить навсегда</button>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						) : (
							<div className="chat-sidebar__trash-pane" role="tabpanel">
								<div className="chat-sidebar__trash-toolbar">
									<button
										className="chat-sidebar__trash-danger"
										type="button"
										disabled={deletedKnowledgeItems.length === 0 || trashBusyId !== null}
										onClick={() => void handleEmptyKnowledgeTrash()}
									>
										<TrashIcon /> Очистить корзину
									</button>
								</div>
								{deletedKnowledgeItems.length === 0 ? <p className="chat-sidebar__trash-empty">Удалённых записей нет</p> : (
									<ul className="chat-sidebar__trash-list">
										{deletedKnowledgeItems.map((item) => (
											<li key={item.id}>
												<div className="chat-sidebar__trash-copy">
													<strong>{item.title}</strong>
													{item.deletedAt && <small>Удалена {new Date(item.deletedAt).toLocaleString('ru-RU')}</small>}
												</div>
												<div className="chat-sidebar__trash-actions">
													<button type="button" disabled={trashBusyId !== null} onClick={() => void handleRestoreKnowledge(item.id)}>Восстановить</button>
													<button className="chat-sidebar__trash-danger" type="button" disabled={trashBusyId !== null} onClick={() => void handlePermanentKnowledgeDelete(item.id)}><TrashIcon /> Удалить навсегда</button>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						)}
					</div>
				</ModalDialog>
			)}
		</>
	);
}
