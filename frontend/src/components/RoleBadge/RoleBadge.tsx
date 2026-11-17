import type { UserRole } from '../../types/chat';
import './_roleBadge.scss';

const ROLE_LABELS: Record<UserRole, string> = {
	user: 'User',
	admin: 'Admin',
	owner: 'Owner',
};

export function RoleBadge({ role }: { role: UserRole }) {
	return <span className={`role-badge role-badge--${role}`}>{ROLE_LABELS[role]}</span>;
}
