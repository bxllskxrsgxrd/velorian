import type { ReactNode } from 'react';

type SettingRowProps = {
	title: string;
	description: string;
	children: ReactNode;
};

export function SettingsToggle({ checked, onChange, label }: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
}) {
	return (
		<button
			className="chat-sidebar__settings-switch"
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
		>
			<span />
		</button>
	);
}

export function SettingRow({ title, description, children }: SettingRowProps) {
	return (
		<div className="chat-sidebar__settings-row">
			<div className="chat-sidebar__settings-row-copy">
				<strong>{title}</strong>
				<p>{description}</p>
			</div>
			<div className="chat-sidebar__settings-control">{children}</div>
		</div>
	);
}
