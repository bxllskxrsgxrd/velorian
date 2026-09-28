import { useMemo, type FormEvent } from 'react';
import { createStore, useStore } from 'zustand';
import { authenticate } from '../../api/chatApi';
import { ApiError } from '../../api/httpClient';
import type { AuthUser } from '../../types/chat';
import { reportError } from '../../utils/reportError';
import { useAuthStore } from '../../stores/authStore';
import { EyeIcon, EyeOffIcon } from '../icons/AppIcons';
import './_authPage.scss';
import { Button } from '../ui/Button/Button';

type AuthPageProps = {
	onAuthenticated: (user: AuthUser) => void;
};

type PasswordVisibilityStore = {
	visible: boolean;
	toggle: () => void;
};

type PasswordFieldProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	autoComplete: string;
	error?: string;
};

function PasswordField({ label, value, onChange, autoComplete, error }: PasswordFieldProps) {
	const store = useMemo(
		() =>
			createStore<PasswordVisibilityStore>((set) => ({
				visible: false,
				toggle: () => set((state) => ({ visible: !state.visible })),
			})),
		[],
	);
	const visible = useStore(store, (state) => state.visible);
	const toggle = useStore(store, (state) => state.toggle);
	return (
		<div className="auth-card__field">
			<label>
				<span>{label}</span>
				<div className="auth-card__password-field">
					<input
						type={visible ? 'text' : 'password'}
						autoComplete={autoComplete}
						minLength={8}
						required
						value={value}
						onChange={(event) => onChange(event.target.value)}
						aria-invalid={Boolean(error)}
					/>
					<button
						className="auth-card__password-toggle"
						type="button"
						onClick={toggle}
						aria-label={visible ? `Скрыть: ${label}` : `Показать: ${label}`}
						title={visible ? 'Скрыть пароль' : 'Показать пароль'}
					>
						{visible ? <EyeOffIcon /> : <EyeIcon />}
					</button>
				</div>
			</label>
			{error && <span className="auth-card__field-error">{error}</span>}
		</div>
	);
}

export function AuthPage({ onAuthenticated }: AuthPageProps) {
	const mode = useAuthStore((state) => state.mode);
	const identifier = useAuthStore((state) => state.identifier);
	const login = useAuthStore((state) => state.login);
	const email = useAuthStore((state) => state.email);
	const password = useAuthStore((state) => state.password);
	const confirmPassword = useAuthStore((state) => state.confirmPassword);
	const error = useAuthStore((state) => state.error);
	const fieldErrors = useAuthStore((state) => state.fieldErrors);
	const loading = useAuthStore((state) => state.isSubmitting);
	const setIdentifier = useAuthStore((state) => state.setIdentifier);
	const setLogin = useAuthStore((state) => state.setLogin);
	const setEmail = useAuthStore((state) => state.setEmail);
	const setPassword = useAuthStore((state) => state.setPassword);
	const setConfirmPassword = useAuthStore((state) => state.setConfirmPassword);
	const setError = useAuthStore((state) => state.setError);
	const setFieldErrors = useAuthStore((state) => state.setFieldErrors);
	const setLoading = useAuthStore((state) => state.setSubmitting);
	const toggleMode = useAuthStore((state) => state.toggleMode);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError('');
		setFieldErrors({});
		if (mode === 'register' && password !== confirmPassword) {
			setFieldErrors({ confirmPassword: 'Пароли не совпадают' });
			return;
		}
		setLoading(true);
		try {
			onAuthenticated(
				await authenticate(mode === 'login' ? { mode, identifier, password } : { mode, login, email, password }),
			);
		} catch (requestError) {
			if (requestError instanceof ApiError && requestError.code === 'LOGIN_EXISTS') {
				setFieldErrors({ login: 'Пользователь с таким логином уже существует' });
			} else if (requestError instanceof ApiError && requestError.code === 'EMAIL_EXISTS') {
				setFieldErrors({ email: 'Пользователь с таким email уже существует' });
			} else {
				reportError('Ошибка авторизации', requestError, { mode });
				setError(requestError instanceof Error ? requestError.message : 'Не удалось войти');
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="auth-page">
			<form className="auth-card" onSubmit={handleSubmit}>
				<div className="auth-card__eyebrow">VELORIAN</div>
				<h1>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h1>
				<p>Диалоги и документы будут храниться в вашем локальном пространстве</p>

				{mode === 'login' ? (
					<label>
						<span>Email или логин</span>
						<input
							type="text"
							autoComplete="username"
							required
							value={identifier}
							onChange={(event) => setIdentifier(event.target.value)}
						/>
					</label>
				) : (
					<>
						<div className="auth-card__field">
							<label>
								<span>Логин</span>
								<input
									type="text"
									autoComplete="username"
									minLength={3}
									required
									value={login}
									aria-invalid={Boolean(fieldErrors.login)}
									onChange={(event) => setLogin(event.target.value)}
								/>
							</label>
							{fieldErrors.login && <span className="auth-card__field-error">{fieldErrors.login}</span>}
						</div>
						<div className="auth-card__field">
							<label>
								<span>Email</span>
								<input
									type="email"
									autoComplete="email"
									required
									value={email}
									aria-invalid={Boolean(fieldErrors.email)}
									onChange={(event) => setEmail(event.target.value)}
								/>
							</label>
							{fieldErrors.email && <span className="auth-card__field-error">{fieldErrors.email}</span>}
						</div>
					</>
				)}
				<PasswordField
					label="Пароль"
					value={password}
					onChange={setPassword}
					autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
				/>
				{mode === 'register' && (
					<PasswordField
						label="Подтвердите пароль"
						value={confirmPassword}
						onChange={setConfirmPassword}
						autoComplete="new-password"
						error={fieldErrors.confirmPassword}
					/>
				)}

				{error && (
					<div className="auth-card__error" role="alert">
						{error}
					</div>
				)}
				<Button variant="filled" tone="accent" size="medium" type="submit" disabled={loading}>
					{loading ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
				</Button>
				<button className="auth-card__switch" type="button" onClick={toggleMode}>
					{mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
				</button>
			</form>
		</main>
	);
}
