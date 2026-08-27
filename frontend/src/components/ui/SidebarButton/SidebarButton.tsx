import type { ButtonHTMLAttributes, ReactNode } from 'react';

import './_sidebarButton.scss';

type SidebarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	icon?: ReactNode;
	active?: boolean;
};

export function SidebarButton({
	icon,
	active = false,
	className = '',
	children,
	...props
}: SidebarButtonProps) {
	const buttonClassName = [
		'sidebar-button',
		active && 'sidebar-button--active',
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button className={buttonClassName} type="button" {...props}>
			{icon && <span className="sidebar-button__icon">{icon}</span>}

			<span className="sidebar-button__label">{children}</span>
		</button>
	);
}