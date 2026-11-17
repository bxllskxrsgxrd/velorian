import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronIcon } from '../icons/AppIcons';
import './_chatSidebar.scss';

type SettingsShellProps = {
	sidebarTitle: string;
	navigation: ReactNode;
	title: string;
	description: string;
	titleId: string;
	children?: ReactNode;
};

export function SettingsShell({
	sidebarTitle,
	navigation,
	title,
	description,
	titleId,
	children,
}: SettingsShellProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const returnPath = typeof location.state?.from === 'string' ? location.state.from : null;

	function handleBack() {
		if (returnPath) navigate(returnPath, { replace: true });
		else navigate('/chat/new', { replace: true });
	}

	return (
		<main className="chat-sidebar__settings-panel" aria-labelledby={titleId}>
			<aside className="chat-sidebar__settings-sidebar">
				<button className="chat-sidebar__settings-back" type="button" onClick={handleBack}>
					<ChevronIcon aria-hidden="true" />
					<span>Вернуться в приложение</span>
				</button>
				<h2>{sidebarTitle}</h2>
				<nav aria-label={`Разделы: ${sidebarTitle}`}>{navigation}</nav>
			</aside>

			<section className="chat-sidebar__settings-workspace">
				<header className="chat-sidebar__settings-header">
					<div>
						<h2 id={titleId}>{title}</h2>
						<p>{description}</p>
					</div>
				</header>
				<div className="chat-sidebar__settings-content">{children}</div>
			</section>
		</main>
	);
}
