import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SettingsShell } from '../ChatSidebar/SettingsShell';
import { LockIcon, UserIcon } from '../icons/AppIcons';

type AdminSection = 'overview' | 'users';

type AdminShellProps = {
	section: AdminSection;
	title: string;
	description: string;
	children?: ReactNode;
};

export function AdminShell({ section, title, description, children }: AdminShellProps) {
	const navigate = useNavigate();
	const location = useLocation();

	function openSection(path: '/admin' | '/admin/users') {
		navigate(path, { state: location.state });
	}

	return (
		<SettingsShell
			sidebarTitle="Администрирование"
			title={title}
			description={description}
			titleId={`admin-${section}-title`}
			navigation={(
				<>
					<button
						className={section === 'overview' ? 'chat-sidebar__settings-nav-item--active' : undefined}
						type="button"
						aria-current={section === 'overview' ? 'page' : undefined}
						onClick={() => openSection('/admin')}
					>
						<LockIcon aria-hidden="true" />
						<span>Обзор</span>
					</button>
					<button
						className={section === 'users' ? 'chat-sidebar__settings-nav-item--active' : undefined}
						type="button"
						aria-current={section === 'users' ? 'page' : undefined}
						onClick={() => openSection('/admin/users')}
					>
						<UserIcon aria-hidden="true" />
						<span>Пользователи</span>
					</button>
				</>
			)}
		>
			{children}
		</SettingsShell>
	);
}
