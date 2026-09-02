import { useEffect, useMemo, useRef } from 'react';
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
					<p>Чат «{dialog.conversation.title}» и его файлы будут удалены без возможности восстановления.</p>
				</ModalDialog>
			)}
		</>
	);
}
