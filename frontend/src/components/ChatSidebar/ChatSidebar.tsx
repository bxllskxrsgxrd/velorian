import { ACCENT_THEMES, ACCENT_THEME_LABELS, type AccentTheme } from '../../theme/accentTheme';
import type { AuthUser, ConversationSummary } from '../../types/chat';
import { NewChatIcon } from '../icons/NewChatIcon';
import { VelorianIcon } from '../icons/VelorianIcon';
import './_chatSidebar.scss';

type ChatSidebarProps = {
	user: AuthUser;
	conversations: ConversationSummary[];
	activeConversationId: string | null;
	search: string;
	accentTheme: AccentTheme;
	isOpen: boolean;
	onSearchChange: (value: string) => void;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
	onRename: (conversation: ConversationSummary) => void;
	onAccentChange: (theme: AccentTheme) => void;
	onExport: (format: 'markdown' | 'json') => void;
	onLogout: () => void;
	onClose: () => void;
};

export function ChatSidebar({
	user,
	conversations,
	activeConversationId,
	search,
	accentTheme,
	isOpen,
	onSearchChange,
	onSelect,
	onNew,
	onDelete,
	onRename,
	onAccentChange,
	onExport,
	onLogout,
	onClose,
}: ChatSidebarProps) {
	return (
		<aside className={isOpen ? 'chat-sidebar chat-sidebar--open' : 'chat-sidebar'} aria-label="Навигация по чатам">
			<div className="chat-sidebar__header">
				<div>
					<span className="chat-sidebar__mark">
						<VelorianIcon />
					</span>
					<strong>Velorian</strong>
				</div>
				<button className="chat-sidebar__mobile-close" type="button" onClick={onClose} aria-label="Закрыть меню">
					×
				</button>
			</div>
			<button className="chat-sidebar__new" type="button" onClick={onNew}>
				<NewChatIcon /> Новый чат
			</button>
			<label className="chat-sidebar__search">
				<span className="chat-sidebar__visually-hidden">Поиск диалогов</span>
				<input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Поиск диалогов" />
			</label>
			<nav className="chat-sidebar__conversations" aria-label="История диалогов">
				{conversations.length === 0 && <p className="chat-sidebar__empty">Диалогов пока нет</p>}
				{conversations.map((conversation) => (
					<div
						className={
							conversation.id === activeConversationId
								? 'chat-sidebar__item chat-sidebar__item--active'
								: 'chat-sidebar__item'
						}
						key={conversation.id}
					>
						<button
							className="chat-sidebar__select"
							type="button"
							onClick={() => onSelect(conversation.id)}
							title={conversation.title}
						>
							{conversation.title}
						</button>
						<button
							type="button"
							onClick={() => onRename(conversation)}
							aria-label={`Переименовать «${conversation.title}»`}
						>
							✎
						</button>
						<button
							type="button"
							onClick={() => onDelete(conversation.id)}
							aria-label={`Удалить «${conversation.title}»`}
						>
							×
						</button>
					</div>
				))}
			</nav>
			<div className="chat-sidebar__settings">
				<label>
					<span>Акцент интерфейса</span>
					<select value={accentTheme} onChange={(event) => onAccentChange(event.target.value as AccentTheme)}>
						{ACCENT_THEMES.map((theme) => (
							<option value={theme} key={theme}>
								{ACCENT_THEME_LABELS[theme]}
							</option>
						))}
					</select>
				</label>
				<div className="chat-sidebar__exports">
					<button type="button" onClick={() => onExport('markdown')}>
						Экспорт .md
					</button>
					<button type="button" onClick={() => onExport('json')}>
						Экспорт .json
					</button>
				</div>
				<div className="chat-sidebar__account">
					<span title={user.email}>{user.email}</span>
					<button type="button" onClick={onLogout}>
						Выйти
					</button>
				</div>
			</div>
		</aside>
	);
}
