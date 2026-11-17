import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RequireAdmin } from '../components/RoleGuard/RequireAdmin';
import type { AuthUser } from '../types/chat';
import { AdminPage } from './AdminPage';

function renderAdmin(role: AuthUser['role']) {
	const user: AuthUser = { id: role, email: `${role}@example.com`, login: role, role };
	const router = createMemoryRouter([
		{
			path: '/admin',
			element: <RequireAdmin user={user}><AdminPage /></RequireAdmin>,
		},
		{ path: '/chat/new', element: <div>Новый чат</div> },
	], { initialEntries: ['/admin'] });
	return render(<RouterProvider router={router} />);
}

describe('AdminPage access', () => {
	it('redirects a regular user without rendering administrative content', async () => {
		renderAdmin('user');

		expect(await screen.findByText('Новый чат')).toBeInTheDocument();
		expect(screen.queryByRole('main', { name: 'Администрирование' })).not.toBeInTheDocument();
	});

	it.each(['admin', 'owner'] as const)('allows %s', (role) => {
		renderAdmin(role);

		expect(screen.getByRole('main', { name: 'Администрирование' })).toBeInTheDocument();
	});
});
