import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './types/chat';
import { useAuthStore } from './stores/authStore';
import App from './App';

const api = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	getRuntimeConfig: vi.fn(),
	logout: vi.fn(),
}));

vi.mock('./api/chatApi', async (importOriginal) => ({
	...await importOriginal<typeof import('./api/chatApi')>(),
	...api,
}));

describe('App role routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useAuthStore.getState().setUser(null);
		useAuthStore.getState().setSessionLoading(true);
		api.getRuntimeConfig.mockResolvedValue(null);
	});

	it('does not render administrative content before /auth/me resolves', async () => {
		let resolveUser!: (user: AuthUser) => void;
		api.getCurrentUser.mockReturnValue(new Promise<AuthUser>((resolve) => {
			resolveUser = resolve;
		}));
		render(<MemoryRouter initialEntries={['/admin']}><App /></MemoryRouter>);

		expect(screen.getByText('Загрузка Velorian…')).toBeInTheDocument();
		expect(screen.queryByRole('main', { name: 'Администрирование' })).not.toBeInTheDocument();

		resolveUser({ id: 'admin', email: 'admin@example.com', login: 'admin', role: 'admin' });
		expect(await screen.findByRole('main', { name: 'Администрирование' })).toBeInTheDocument();
	});

	it('does not mount a direct personal analytics route without a session', async () => {
		api.getCurrentUser.mockRejectedValue(new Error('unauthorized'));
		render(<MemoryRouter initialEntries={['/profile/usage']}><App /></MemoryRouter>);

		expect(await screen.findByRole('heading', { name: 'С возвращением' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Использование AI' })).not.toBeInTheDocument();
	});
});
