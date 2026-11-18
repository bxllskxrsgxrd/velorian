import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileSecurity, ProfileUsageSummary } from '../types/profile';
import { ProfileActivityPage } from './ProfileActivityPage';
import { ProfileSecurityPage } from './ProfileSecurityPage';
import { ProfileUsagePage } from './ProfileUsagePage';

const api = vi.hoisted(() => ({
	getProfileUsage: vi.fn(),
	getProfileUsageEvents: vi.fn(),
	getProfileActivity: vi.fn(),
	getProfileSecurity: vi.fn(),
}));

vi.mock('../api/profileApi', () => api);

const summary: ProfileUsageSummary = {
	period: '30d',
	from: '2026-10-19T10:00:00Z',
	totals: {
		requestCount: 3,
		successCount: 2,
		errorCount: 1,
		cancelledCount: 0,
		inputTokens: 362,
		outputTokens: 22,
		cachedTokens: null,
		totalTokens: 384,
		knownCostUsd: null,
		unknownCostCount: 3,
		unknownTokenCount: 0,
	},
	models: [{
		provider: 'groq', model: 'openai/gpt-oss-120b', requestCount: 3, totalTokens: 384,
		knownCostUsd: null, unknownCostCount: 3,
	}],
	purposes: [{ purpose: 'title', requestCount: 1, totalTokens: 384, knownCostUsd: null, unknownCostCount: 1 }],
};

const security: ProfileSecurity = {
	account: {
		id: 'user-1', login: 'profile-user', email: 'profile@example.com', role: 'user', createdAt: '2026-01-01T10:00:00Z',
	},
	lastSuccessfulLoginAt: null,
	authEvents: [],
};

function renderProfileRoute(path: string) {
	const router = createMemoryRouter([
		{ path: '/profile', element: <div>Основной профиль</div> },
		{ path: '/profile/usage', element: <ProfileUsagePage /> },
		{ path: '/profile/activity', element: <ProfileActivityPage /> },
		{ path: '/profile/security', element: <ProfileSecurityPage /> },
		{ path: '/chat/new', element: <div>Новый чат</div> },
	], { initialEntries: [path] });
	return { router, ...render(<RouterProvider router={router} />) };
}

describe('profile analytics pages', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.getProfileUsage.mockResolvedValue(summary);
		api.getProfileUsageEvents.mockImplementation(({ page }: { page: number }) => Promise.resolve({
			events: [{
				id: `usage-${page}`,
				createdAt: '2026-11-18T10:00:00Z',
				provider: 'groq',
				model: 'openai/gpt-oss-120b',
				purpose: 'title',
				taskType: 'title',
				status: 'success',
				inputTokens: 362,
				outputTokens: 22,
				cachedTokens: null,
				totalTokens: 384,
				estimatedCostUsd: null,
				latencyMs: 120,
			}],
			page,
			pageSize: 20,
			total: 21,
			totalPages: 2,
		}));
		api.getProfileActivity.mockImplementation(({ page }: { page: number }) => Promise.resolve({
			events: [{
				id: `activity-${page}`,
				eventType: 'conversation.created',
				resourceType: 'conversation',
				status: 'success',
				createdAt: '2026-11-18T09:00:00Z',
			}],
			page,
			pageSize: 20,
			total: 21,
			totalPages: 2,
		}));
		api.getProfileSecurity.mockResolvedValue(security);
	});

	it('renders usage, preserves unknown cost, filters and paginates', async () => {
		renderProfileRoute('/profile/usage');
		expect(screen.getByText('Загрузка статистики…')).toBeInTheDocument();
		expect(await screen.findByText('Использование моделей')).toBeInTheDocument();
		const costCard = screen.getByText('Ориентировочные расходы').closest('article');
		expect(costCard).not.toBeNull();
		expect(within(costCard!).getByText('Нет данных')).toBeInTheDocument();
		expect(within(costCard!).getByText('3 выз. без данных о стоимости')).toBeInTheDocument();
		expect(await screen.findAllByText('openai/gpt-oss-120b')).not.toHaveLength(0);

		fireEvent.click(screen.getByRole('button', { name: 'Период статистики' }));
		fireEvent.click(screen.getByRole('option', { name: '7 дней' }));
		await waitFor(() => expect(api.getProfileUsage).toHaveBeenLastCalledWith('7d'));
		await waitFor(() => expect(api.getProfileUsageEvents).toHaveBeenLastCalledWith(expect.objectContaining({ period: '7d', page: 1 })));

		fireEvent.click(screen.getByRole('button', { name: 'Фильтр по статусу' }));
		fireEvent.click(screen.getByRole('option', { name: 'Ошибка' }));
		await waitFor(() => expect(api.getProfileUsageEvents).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', page: 1 })));

		fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
		await waitFor(() => expect(api.getProfileUsageEvents).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', page: 2 })));
	});

	it('shows empty and retryable error states', async () => {
		api.getProfileUsage.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...summary, models: [], purposes: [] });
		api.getProfileUsageEvents.mockResolvedValue({ events: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
		renderProfileRoute('/profile/usage');

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('Не удалось загрузить статистику.');
		fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
		expect(await screen.findByText('За выбранный период вызовов нет.')).toBeInTheDocument();
		expect(screen.getByText('AI-запросы не найдены.')).toBeInTheDocument();
	});

	it('uses centralized activity labels, filters, navigation and browser history', async () => {
		const { router } = renderProfileRoute('/profile/activity');
		expect(await screen.findByText('Создан чат')).toBeInTheDocument();
		expect(screen.getByText('Чат')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Фильтр по типу действия' }));
		fireEvent.click(screen.getByRole('option', { name: 'Выполнен вход' }));
		await waitFor(() => expect(api.getProfileActivity).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: 'auth.login' })));

		fireEvent.click(screen.getByRole('button', { name: 'Безопасность' }));
		expect(await screen.findByRole('heading', { name: 'Безопасность' })).toBeInTheDocument();
		void router.navigate(-1);
		expect(await screen.findByRole('heading', { name: 'Активность' })).toBeInTheDocument();
	});

	it('shows only real security data without fake actions', async () => {
		renderProfileRoute('/profile/security');
		expect(await screen.findByText('profile@example.com')).toBeInTheDocument();
		expect(screen.getByText('User')).toBeInTheDocument();
		expect(screen.getByText('Последний успешный вход').parentElement).toHaveTextContent('Нет данных');
		expect(screen.getByText('История входов пока отсутствует.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Сменить пароль|Завершить все сессии|Включить 2FA/ })).not.toBeInTheDocument();
	});
});
