import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAdmin } from '../components/RoleGuard/RequireAdmin';
import { useNotificationsStore } from '../stores/notificationsStore';
import type { AdminUser, AdminUsersResult, AuthUser } from '../types/chat';
import { AdminUsersPage } from './AdminUsersPage';

const api = vi.hoisted(() => ({
	listAdminUsers: vi.fn(),
	updateAdminUserRole: vi.fn(),
}));

vi.mock('../api/adminApi', () => api);

const users: AdminUser[] = [
	{ id: 'user-1', login: 'alice', email: 'alice@example.com', role: 'user', createdAt: '2026-11-17T10:00:00Z' },
	{ id: 'admin-1', login: 'moderator', email: 'moderator@example.com', role: 'admin', createdAt: '2026-11-17T10:01:00Z' },
	{ id: 'owner-1', login: 'founder', email: 'founder@example.com', role: 'owner', createdAt: '2026-11-17T10:02:00Z' },
];

function result(overrides: Partial<AdminUsersResult> = {}): AdminUsersResult {
	return { users, page: 1, pageSize: 20, total: users.length, totalPages: 1, ...overrides };
}

function renderPage(role: AuthUser['role']) {
	const currentUser: AuthUser = {
		id: `current-${role}`,
		login: `current-${role}`,
		email: `${role}@example.com`,
		role,
	};
	const router = createMemoryRouter([
		{
			path: '/admin/users',
			element: <RequireAdmin user={currentUser}><AdminUsersPage currentUser={currentUser} /></RequireAdmin>,
		},
		{ path: '/admin', element: <div>Административный обзор</div> },
		{ path: '/chat/new', element: <div>Новый чат</div> },
	], { initialEntries: ['/admin/users'] });
	return render(<RouterProvider router={router} />);
}

describe('AdminUsersPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.listAdminUsers.mockResolvedValue(result());
		useNotificationsStore.setState({ toasts: [] });
	});

	it('protects the direct route from a regular user', async () => {
		renderPage('user');

		expect(await screen.findByText('Новый чат')).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Пользователи' })).not.toBeInTheDocument();
		expect(api.listAdminUsers).not.toHaveBeenCalled();
	});

	it('allows an admin to view users without role controls', async () => {
		renderPage('admin');

		expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
		expect(screen.getByText('User')).toBeInTheDocument();
		expect(screen.getByText('Admin')).toBeInTheDocument();
		expect(screen.getByText('Owner')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Назначить администратором' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Снять права администратора' })).not.toBeInTheDocument();
	});

	it('applies search and pagination parameters', async () => {
		api.listAdminUsers.mockResolvedValue(result({ total: 25, totalPages: 2 }));
		renderPage('owner');
		await screen.findByText('alice@example.com');

		fireEvent.change(screen.getByRole('textbox', { name: 'Поиск пользователей по логину или email' }), {
			target: { value: 'alice@example.com' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
		await waitFor(() => expect(api.listAdminUsers).toHaveBeenLastCalledWith({
			search: 'alice@example.com', page: 1, pageSize: 20,
		}));

		fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
		await waitFor(() => expect(api.listAdminUsers).toHaveBeenLastCalledWith({
			search: 'alice@example.com', page: 2, pageSize: 20,
		}));
	});

	it('lets an owner confirm a role change and updates the row without reload', async () => {
		api.updateAdminUserRole.mockResolvedValue({
			user: { ...users[0], role: 'admin' },
			changed: true,
		});
		renderPage('owner');
		const email = await screen.findByText('alice@example.com');
		const row = email.closest('tr');
		expect(row).not.toBeNull();

		fireEvent.click(within(row!).getByRole('button', { name: 'Назначить администратором' }));
		const dialog = screen.getByRole('dialog', { name: 'Назначить администратора?' });
		expect(within(dialog).getByText('alice')).toBeInTheDocument();
		fireEvent.click(within(dialog).getByRole('button', { name: 'Назначить' }));

		await waitFor(() => expect(api.updateAdminUserRole).toHaveBeenCalledWith('user-1', 'admin'));
		expect(await within(row!).findByText('Admin')).toBeInTheDocument();
		expect(within(row!).getByRole('button', { name: 'Снять права администратора' })).toBeInTheDocument();
		expect(screen.getByText('Роль владельца защищена')).toBeInTheDocument();
		expect(useNotificationsStore.getState().toasts.at(-1)?.kind).toBe('success');
	});

	it('shows loading, empty and request error states', async () => {
		let resolveRequest!: (value: AdminUsersResult) => void;
		api.listAdminUsers.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
		const view = renderPage('admin');
		expect(screen.getByText('Загрузка пользователей…')).toBeInTheDocument();
		resolveRequest(result({ users: [], total: 0, totalPages: 0 }));
		expect(await screen.findByText('Пользователи не найдены')).toBeInTheDocument();

		view.unmount();
		api.listAdminUsers.mockRejectedValueOnce(new Error('offline'));
		renderPage('admin');
		expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить пользователей.');
	});

	it('does not show false success when a role update fails', async () => {
		api.updateAdminUserRole.mockRejectedValue(new Error('denied'));
		renderPage('owner');
		const email = await screen.findByText('alice@example.com');
		const row = email.closest('tr');
		fireEvent.click(within(row!).getByRole('button', { name: 'Назначить администратором' }));
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Назначить' }));

		expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить роль пользователя');
		expect(within(row!).getByText('User')).toBeInTheDocument();
		expect(useNotificationsStore.getState().toasts.at(-1)?.kind).toBe('error');
	});
});
