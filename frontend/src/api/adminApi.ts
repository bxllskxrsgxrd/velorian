import type { AdminUser, AdminUsersResult, UserRole } from '../types/chat';
import { requestJson } from './httpClient';

export async function listAdminUsers({
	search = '',
	page = 1,
	pageSize = 20,
}: {
	search?: string;
	page?: number;
	pageSize?: number;
} = {}): Promise<AdminUsersResult> {
	const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
	if (search) params.set('search', search);
	return requestJson<AdminUsersResult>(`/admin/users?${params}`);
}

export async function updateAdminUserRole(userId: string, role: Extract<UserRole, 'user' | 'admin'>) {
	return requestJson<{ user: AdminUser; changed: boolean }>(`/admin/users/${encodeURIComponent(userId)}/role`, {
		method: 'PATCH',
		body: JSON.stringify({ role }),
	});
}
