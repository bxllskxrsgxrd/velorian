import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { useAuthStore } from '../../stores/authStore';
import { AuthPage } from './AuthPage';

const api = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('../../api/chatApi', () => api);

beforeEach(() => {
	vi.clearAllMocks();
	useAuthStore.getState().resetForm();
	useAuthStore.getState().setMode('login');
});

describe('AuthPage', () => {
	it('logs in with one email-or-login field and can reveal the password', async () => {
		const onAuthenticated = vi.fn();
		api.authenticate.mockResolvedValue({ id: 'user', login: 'poet', email: 'poet@example.com' });
		render(<AuthPage onAuthenticated={onAuthenticated} />);

		fireEvent.change(screen.getByRole('textbox', { name: 'Email или логин' }), { target: { value: 'poet' } });
		const password = screen.getByLabelText('Пароль');
		fireEvent.change(password, { target: { value: 'strong-password' } });
		expect(password).toHaveAttribute('type', 'password');
		fireEvent.click(screen.getByRole('button', { name: 'Показать: Пароль' }));
		expect(password).toHaveAttribute('type', 'text');
		fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

		await waitFor(() =>
			expect(api.authenticate).toHaveBeenCalledWith({
				mode: 'login',
				identifier: 'poet',
				password: 'strong-password',
			}),
		);
		expect(onAuthenticated).toHaveBeenCalledOnce();
	});

	it('requires matching password confirmation before registration', () => {
		render(<AuthPage onAuthenticated={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Нет аккаунта? Создать' }));

		fireEvent.change(screen.getByRole('textbox', { name: 'Логин' }), {
			target: { value: 'poet' },
		});

		fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
			target: { value: 'poet@example.com' },
		});

		fireEvent.change(screen.getByLabelText('Пароль'), {
			target: { value: 'strong-password' },
		});

		const confirmPassword = screen.getByLabelText('Подтвердите пароль');

		fireEvent.change(confirmPassword, {
			target: { value: 'different-password' },
		});

		fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

		expect(screen.getByText('Пароли не совпадают')).toBeInTheDocument();
		expect(confirmPassword).toHaveAttribute('aria-invalid', 'true');
		expect(api.authenticate).not.toHaveBeenCalled();
	});

	it.each([
		['LOGIN_EXISTS', 'Логин', 'Пользователь с таким логином уже существует'],
		['EMAIL_EXISTS', 'Email', 'Пользователь с таким email уже существует'],
	] as const)('shows %s on its registration field', async (code, field, message) => {
		api.authenticate.mockRejectedValue(new ApiError(code, 409));
		render(<AuthPage onAuthenticated={vi.fn()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Нет аккаунта? Создать' }));
		fireEvent.change(screen.getByRole('textbox', { name: 'Логин' }), { target: { value: 'poet' } });
		fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'poet@example.com' } });
		fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'strong-password' } });
		fireEvent.change(screen.getByLabelText('Подтвердите пароль'), { target: { value: 'strong-password' } });
		fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

		expect(await screen.findByText(message)).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: field })).toHaveAttribute('aria-invalid', 'true');
	});
});
