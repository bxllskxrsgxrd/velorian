import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListIcon, LockIcon, StarIcon, UserIcon } from '../icons/AppIcons';
import { SettingsShell } from '../ChatSidebar/SettingsShell';

export type ProfileSection = 'profile' | 'usage' | 'activity' | 'security';

type ProfileShellProps = {
	section: ProfileSection;
	title: string;
	description: string;
	children?: ReactNode;
};

const SECTIONS = [
	{ id: 'profile', path: '/profile', label: 'Профиль', Icon: UserIcon },
	{ id: 'usage', path: '/profile/usage', label: 'Использование AI', Icon: StarIcon },
	{ id: 'activity', path: '/profile/activity', label: 'Активность', Icon: ListIcon },
	{ id: 'security', path: '/profile/security', label: 'Безопасность', Icon: LockIcon },
] as const;

export function ProfileShell({ section, title, description, children }: ProfileShellProps) {
	const navigate = useNavigate();
	const location = useLocation();

	return (
		<SettingsShell
			sidebarTitle="Профиль"
			title={title}
			description={description}
			titleId={`profile-${section}-title`}
			navigation={SECTIONS.map(({ id, path, label, Icon }) => (
				<button
					key={id}
					className={section === id ? 'chat-sidebar__settings-nav-item--active' : undefined}
					type="button"
					aria-current={section === id ? 'page' : undefined}
					onClick={() => navigate(path, { state: location.state })}
				>
					<Icon aria-hidden="true" />
					<span>{label}</span>
				</button>
			))}
		>
			{children}
		</SettingsShell>
	);
}
