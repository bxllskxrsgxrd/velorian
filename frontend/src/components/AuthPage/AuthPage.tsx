import { useMemo, type FormEvent } from 'react';
import { createStore, useStore } from 'zustand';
import { authenticate } from '../../api/chatApi';
import { ApiError } from '../../api/httpClient';
import type { AuthUser } from '../../types/chat';
import { reportError } from '../../utils/reportError';
import { useAuthStore, type AuthField, type AuthFieldErrors } from '../../stores/authStore';
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

const AUTH_FIELDS = new Set<AuthField>(['identifier', 'login', 'email', 'password', 'confirmPassword']);

function validateForm(mode: 'login' | 'register', values: {
	identifier: string;
	login: string;
	email: string;
	password: string;
	confirmPassword: string;
}): AuthFieldErrors {
	const errors: AuthFieldErrors = {};
	if (mode === 'login') {
		const identifier = values.identifier.trim();
		if (!identifier) errors.identifier = 'Введите email или логин';
		else if (identifier.length < 3 || identifier.length > 320) errors.identifier = 'Email или логин должен содержать от 3 до 320 символов';
	} else {
		const login = values.login.trim();
		const email = values.email.trim();
		if (!login) errors.login = 'Введите логин';
		else if (login.length < 3 || login.length > 80) errors.login = 'Логин должен содержать от 3 до 80 символов';
		else if (/\s|@/.test(login)) errors.login = 'Логин не должен содержать пробелы или символ @';
		if (!email) errors.email = 'Введите email';
		else if (email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) errors.email = 'Введите корректный email';
		if (!values.confirmPassword) errors.confirmPassword = 'Подтвердите пароль';
		else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Пароли не совпадают';
	}
	if (!values.password) errors.password = 'Введите пароль';
	else if (values.password.length < 8 || values.password.length > 128) errors.password = 'Пароль должен содержать от 8 до 128 символов';
	return errors;
}

function backendFieldErrors(error: ApiError): AuthFieldErrors {
	if (error.code === 'LOGIN_EXISTS') return { login: 'Пользователь с таким логином уже существует' };
	if (error.code === 'EMAIL_EXISTS') return { email: 'Пользователь с таким email уже существует' };
	if (error.code === 'INVALID_EMAIL') return { email: 'Введите корректный email' };
	const errors: AuthFieldErrors = {};
	const detailsErrors = error.details?.fieldErrors;
	if (detailsErrors && typeof detailsErrors === 'object') {
		for (const [field, message] of Object.entries(detailsErrors)) {
			if (AUTH_FIELDS.has(field as AuthField) && typeof message === 'string') errors[field as AuthField] = message;
		}
	}
	const field = error.details?.field;
	if (typeof field === 'string' && AUTH_FIELDS.has(field as AuthField) && !errors[field as AuthField]) {
		errors[field as AuthField] = error.developerMessage ?? error.message;
	}
	return errors;
}

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
						maxLength={128}
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
	function clearFieldErrors(...fields: AuthField[]) {
		if (!fields.some((field) => fieldErrors[field])) return;
		const next = { ...fieldErrors };
		fields.forEach((field) => delete next[field]);
		setFieldErrors(next);
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError('');
		const validationErrors = validateForm(mode, { identifier, login, email, password, confirmPassword });
		setFieldErrors(validationErrors);
		if (Object.keys(validationErrors).length > 0) {
			return;
		}
		setLoading(true);
		try {
			onAuthenticated(
				await authenticate(mode === 'login' ? { mode, identifier, password } : { mode, login, email, password }),
			);
		} catch (requestError) {
			const responseFieldErrors = requestError instanceof ApiError ? backendFieldErrors(requestError) : {};
			if (Object.keys(responseFieldErrors).length > 0) {
				setFieldErrors(responseFieldErrors);
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
			<form className="auth-card" onSubmit={handleSubmit} noValidate>
				<div className="auth-card__eyebrow">VELORIAN</div>
				<h1>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h1>
				<p>Диалоги и документы будут храниться в вашем локальном пространстве</p>

				{mode === 'login' ? (
					<div className="auth-card__field">
						<label>
							<span>Email или логин</span>
							<input
								type="text"
								autoComplete="username"
								required
								maxLength={320}
								value={identifier}
								aria-invalid={Boolean(fieldErrors.identifier)}
								onChange={(event) => {
									setIdentifier(event.target.value);
									clearFieldErrors('identifier');
								}}
							/>
						</label>
						{fieldErrors.identifier && <span className="auth-card__field-error">{fieldErrors.identifier}</span>}
					</div>
				) : (
					<>
						<div className="auth-card__field">
							<label>
								<span>Логин</span>
								<input
									type="text"
									autoComplete="username"
									minLength={3}
									maxLength={80}
									required
									value={login}
									aria-invalid={Boolean(fieldErrors.login)}
									onChange={(event) => {
										setLogin(event.target.value);
										clearFieldErrors('login');
									}}
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
									maxLength={320}
									value={email}
									aria-invalid={Boolean(fieldErrors.email)}
									onChange={(event) => {
										setEmail(event.target.value);
										clearFieldErrors('email');
									}}
								/>
							</label>
							{fieldErrors.email && <span className="auth-card__field-error">{fieldErrors.email}</span>}
						</div>
					</>
				)}
				<PasswordField
					label="Пароль"
					value={password}
					onChange={(value) => {
						setPassword(value);
						clearFieldErrors('password', 'confirmPassword');
					}}
					autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
					error={fieldErrors.password}
				/>
				{mode === 'register' && (
					<PasswordField
						label="Подтвердите пароль"
						value={confirmPassword}
						onChange={(value) => {
							setConfirmPassword(value);
							clearFieldErrors('confirmPassword');
						}}
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
