import { LockIcon } from '../components/icons/AppIcons';
import { SettingsShell } from '../components/ChatSidebar/SettingsShell';

export function AdminPage() {
	return (
		<SettingsShell
			sidebarTitle="Администрирование"
			title="Администрирование"
			description="Раздел для управления Velorian"
			titleId="admin-page-title"
			navigation={(
				<button className="chat-sidebar__settings-nav-item--active" type="button" aria-current="page">
					<LockIcon aria-hidden="true" />
					<span>Администрирование</span>
				</button>
			)}
		/>
	);
}
