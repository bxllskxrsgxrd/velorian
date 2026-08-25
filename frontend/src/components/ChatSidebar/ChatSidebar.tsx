import { useEffect, useRef, useState } from 'react';
import { ACCENT_THEMES, ACCENT_THEME_LABELS, type AccentTheme } from '../../theme/accentTheme';
import type { AuthUser, ConversationSummary } from '../../types/chat';
import { ChevronIcon, EditIcon, KnowledgeIcon, LogoutIcon, MoreIcon, SearchIcon, SettingsIcon, SidebarIcon, TrashIcon, UserIcon } from '../icons/AppIcons';
import { NewChatIcon } from '../icons/NewChatIcon';
import { VelorianIcon } from '../icons/VelorianIcon';
import { ModalDialog } from '../ui/ModalDialog/ModalDialog';
import './_chatSidebar.scss';

type ChatSidebarProps = {
	user: AuthUser;
	conversations: ConversationSummary[];
	activeConversationId: string | null;
	search: string;
	accentTheme: AccentTheme;
	isOpen: boolean;
	isCollapsed: boolean;
	onSearchChange: (value: string) => void;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
	onRename: (conversation: ConversationSummary, title: string) => void;
	onAccentChange: (theme: AccentTheme) => void;
	onExport: (format: 'markdown' | 'json') => void;
	onLogout: () => void;
	onOpenKnowledge: () => void;
	onClose: () => void;
	onToggleCollapsed: () => void;
	activeSection?: 'chat' | 'knowledge';
};

type DialogState = { type: 'rename' | 'delete'; conversation: ConversationSummary } | null;

export function ChatSidebar(props: ChatSidebarProps) {
	const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
	const [accountOpen, setAccountOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [draftTitle, setDraftTitle] = useState('');
	const sidebarRef = useRef<HTMLElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		function closeMenus(event: MouseEvent) {
			if (!sidebarRef.current?.contains(event.target as Node)) {
				setConversationMenuId(null);
				setAccountOpen(false);
			}
		}
		document.addEventListener('mousedown', closeMenus);
		return () => document.removeEventListener('mousedown', closeMenus);
	}, []);

	function openDialog(type: 'rename' | 'delete', conversation: ConversationSummary) {
		setConversationMenuId(null);
		setDraftTitle(conversation.title);
		setDialog({ type, conversation });
	}

	function openCollapsedSearch() {
		props.onToggleCollapsed();
		requestAnimationFrame(() => searchInputRef.current?.focus());
	}

	const sidebarClass = [
		'chat-sidebar',
		props.isOpen && 'chat-sidebar--open',
		props.isCollapsed && 'chat-sidebar--collapsed',
	].filter(Boolean).join(' ');

	return (
		<>
			<aside ref={sidebarRef} className={sidebarClass} aria-label="Навигация по чатам">
				<div className="chat-sidebar__header">
					<div className="chat-sidebar__brand">
						<button className="chat-sidebar__mark" type="button" onClick={props.isCollapsed ? props.onToggleCollapsed : undefined} tabIndex={props.isCollapsed ? 0 : -1} aria-label={props.isCollapsed ? 'Развернуть боковую панель' : undefined}>
							<span className="chat-sidebar__logo"><VelorianIcon /></span>
							<span className="chat-sidebar__expand"><SidebarIcon /></span>
						</button>
						<strong>Velorian</strong>
					</div>
					<button className="chat-sidebar__collapse" type="button" onClick={props.onToggleCollapsed} aria-label={props.isCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}><SidebarIcon /></button>
					<button className="chat-sidebar__mobile-close" type="button" onClick={props.onClose} aria-label="Закрыть меню">×</button>
				</div>
				<button className="chat-sidebar__new" type="button" onClick={props.onNew} title="Новый чат"><NewChatIcon /><span>Новый чат</span></button>
				<button className={`chat-sidebar__knowledge${props.activeSection === 'knowledge' ? ' chat-sidebar__knowledge--active' : ''}`} type="button" onClick={props.onOpenKnowledge} title="База знаний" aria-current={props.activeSection === 'knowledge' ? 'page' : undefined}><KnowledgeIcon /><span>База знаний</span></button>
				<button className="chat-sidebar__search-trigger" type="button" onClick={openCollapsedSearch} aria-label="Развернуть панель и найти чат" title="Поиск диалогов"><SearchIcon /></button>
				<label className="chat-sidebar__search">
					<span className="chat-sidebar__visually-hidden">Поиск диалогов</span>
					<SearchIcon />
					<input ref={searchInputRef} value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="Поиск диалогов" />
				</label>
				<nav className="chat-sidebar__conversations" aria-label="История диалогов">
					{props.conversations.length === 0 && <p className="chat-sidebar__empty">Диалогов пока нет</p>}
					{props.conversations.map((conversation) => (
						<div className={conversation.id === props.activeConversationId ? 'chat-sidebar__item chat-sidebar__item--active' : 'chat-sidebar__item'} key={conversation.id}>
							<button className="chat-sidebar__select" type="button" onClick={() => props.onSelect(conversation.id)} title={conversation.title}>
								<span>{conversation.title}</span>
							</button>
							<button className="chat-sidebar__more" type="button" onClick={() => setConversationMenuId((current) => current === conversation.id ? null : conversation.id)} aria-label={`Действия с чатом «${conversation.title}»`}><MoreIcon /></button>
							{conversationMenuId === conversation.id && (
								<div className="chat-sidebar__context-menu">
									<button type="button" onClick={() => openDialog('rename', conversation)}><EditIcon />Переименовать</button>
									<button className="chat-sidebar__danger" type="button" onClick={() => openDialog('delete', conversation)}><TrashIcon />Удалить</button>
								</div>
							)}
						</div>
					))}
				</nav>
				<div className="chat-sidebar__account-wrap">
					{accountOpen && (
						<div className="chat-sidebar__account-menu">
							<button type="button" onClick={() => setSettingsOpen((current) => !current)}><SettingsIcon /><span>Настройки</span><ChevronIcon /></button>
							{settingsOpen && (
								<div className="chat-sidebar__settings-panel">
									<label><span>Акцент интерфейса</span><select value={props.accentTheme} onChange={(event) => props.onAccentChange(event.target.value as AccentTheme)}>{ACCENT_THEMES.map((theme) => <option value={theme} key={theme}>{ACCENT_THEME_LABELS[theme]}</option>)}</select></label>
									<div><button type="button" onClick={() => props.onExport('markdown')}>Экспорт .md</button><button type="button" onClick={() => props.onExport('json')}>Экспорт .json</button></div>
								</div>
							)}
							<button type="button" onClick={props.onLogout}><LogoutIcon /><span>Выйти</span></button>
						</div>
					)}
					<button className="chat-sidebar__account" type="button" onClick={() => setAccountOpen((current) => !current)} aria-expanded={accountOpen} title={props.user.email}>
						<span className="chat-sidebar__avatar"><UserIcon /></span><span className="chat-sidebar__account-copy"><strong>{props.user.email.split('@')[0]}</strong><small>{props.user.email}</small></span><MoreIcon />
					</button>
				</div>
			</aside>

			{dialog?.type === 'rename' && (
				<ModalDialog title="Переименовать чат" confirmLabel="Сохранить" onClose={() => setDialog(null)} onConfirm={() => { const title = draftTitle.trim(); if (title) { props.onRename(dialog.conversation, title); setDialog(null); } }}>
					<input autoFocus value={draftTitle} maxLength={160} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draftTitle.trim()) { props.onRename(dialog.conversation, draftTitle.trim()); setDialog(null); } }} />
				</ModalDialog>
			)}
			{dialog?.type === 'delete' && (
				<ModalDialog title="Удалить чат?" confirmLabel="Удалить" danger onClose={() => setDialog(null)} onConfirm={() => { props.onDelete(dialog.conversation.id); setDialog(null); }}>
					<p>Чат «{dialog.conversation.title}» и его файлы будут удалены без возможности восстановления.</p>
				</ModalDialog>
			)}
		</>
	);
}
