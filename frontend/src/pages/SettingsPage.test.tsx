import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsPage } from './SettingsPage';

const user = { id: 'user', email: 'user@example.com', login: 'user' };

function renderSettings(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
	const router = createMemoryRouter([
		{ path: '/settings', element: <SettingsPage user={user} /> },
		{ path: '/chat/new', element: <div>Новый чат</div> },
		{ path: '/chat/source', element: <div>Исходная страница</div> },
	], { initialEntries, initialIndex: initialEntries.length - 1 });

	return { router, ...render(<RouterProvider router={router} />) };
}

describe('SettingsPage', () => {
	it('uses /chat/new as the direct-entry fallback', async () => {
		renderSettings(['/settings']);

		expect(screen.getByRole('main', { name: 'Общие' })).toBeInTheDocument();
		expect(screen.queryByRole('dialog', { name: 'Общие' })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Вернуться в приложение' }));

		expect(await screen.findByText('Новый чат')).toBeInTheDocument();
	});

	it('guards browser Back when local settings were changed', async () => {
		const { router } = renderSettings([
			'/chat/source',
			{ pathname: '/settings', state: { from: '/chat/source' } },
		]);

		fireEvent.click(screen.getByRole('button', { name: 'Учетная запись' }));
		fireEvent.change(screen.getByDisplayValue('user'), { target: { value: 'changed-user' } });
		void router.navigate(-1);

		expect(await screen.findByRole('dialog', { name: 'Есть несохранённые изменения' })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

		await waitFor(() => expect(screen.getByText('Исходная страница')).toBeInTheDocument());
	});
});
