import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProfilePage } from './ProfilePage';

const user = { id: 'user', email: 'user@example.com', login: 'actual-user', role: 'user' as const };

describe('ProfilePage', () => {
	it('opens independently and preserves the former account fields and navigation guard', async () => {
		const router = createMemoryRouter([
			{ path: '/profile', element: <ProfilePage user={user} /> },
			{ path: '/chat/source', element: <div>Исходная страница</div> },
		], {
			initialEntries: ['/chat/source', { pathname: '/profile', state: { from: '/chat/source' } }],
			initialIndex: 1,
		});
		render(<RouterProvider router={router} />);

		expect(screen.getByRole('main', { name: 'Профиль' })).toBeInTheDocument();
		expect(screen.getByDisplayValue('actual-user')).toBeInTheDocument();
		expect(screen.getByDisplayValue('user@example.com')).toBeDisabled();
		expect(screen.getByText('Безопасность')).toBeInTheDocument();

		fireEvent.change(screen.getByDisplayValue('actual-user'), { target: { value: 'changed-user' } });
		void router.navigate(-1);
		expect(await screen.findByRole('dialog', { name: 'Есть несохранённые изменения' })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

		await waitFor(() => expect(screen.getByText('Исходная страница')).toBeInTheDocument());
	});
});
