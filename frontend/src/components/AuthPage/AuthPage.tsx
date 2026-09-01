import type { FormEvent } from 'react';
import { authenticate } from '../../api/chatApi';
import type { AuthUser } from '../../types/chat';
import { reportError } from '../../utils/reportError';
import { useAuthStore } from '../../stores/authStore';
import './_authPage.scss';

type AuthPageProps = {
	onAuthenticated: (user: AuthUser) => void;
};

export function AuthPage({ onAuthenticated }: AuthPageProps) {
	const mode = useAuthStore((state) => state.mode);
	const email = useAuthStore((state) => state.email);
	const password = useAuthStore((state) => state.password);
	const error = useAuthStore((state) => state.error);
	const loading = useAuthStore((state) => state.isSubmitting);
	const setEmail = useAuthStore((state) => state.setEmail);
	const setPassword = useAuthStore((state) => state.setPassword);
	const setError = useAuthStore((state) => state.setError);
	const setLoading = useAuthStore((state) => state.setSubmitting);
	const toggleMode = useAuthStore((state) => state.toggleMode);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError('');
		setLoading(true);
		try {
			onAuthenticated(await authenticate(mode, email, password));
		} catch (requestError) {
			reportError('Ошибка авторизации', requestError, { mode });
			setError(requestError instanceof Error ? requestError.message : 'Не удалось войти');
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

				<label>
					<span>Email</span>
					<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
				</label>
				<label>
					<span>Пароль</span>
					<input
						type="password"
						autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
						minLength={8}
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</label>

				{error && <div className="auth-card__error" role="alert">{error}</div>}
				<button className="auth-card__submit" disabled={loading} type="submit">
					{loading ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
				</button>
				<button className="auth-card__switch" type="button" onClick={toggleMode}>
					{mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
				</button>
			</form>
		</main>
	);
}
