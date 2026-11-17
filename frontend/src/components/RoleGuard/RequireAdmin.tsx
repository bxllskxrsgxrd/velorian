import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { AuthUser } from '../../types/chat';

export function RequireAdmin({ user, children }: { user: AuthUser; children: ReactNode }) {
	if (user.role !== 'admin' && user.role !== 'owner') return <Navigate to="/chat/new" replace />;
	return children;
}
