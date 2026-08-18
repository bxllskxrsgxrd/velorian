import { useState, type FormEvent } from 'react';
import { authenticate } from '../../api/chatApi';
import type { AuthUser } from '../../types/chat';
import './_authPage.scss';

type AuthPageProps = {
	onAuthenticated: (user: AuthUser) => void;
};

export function AuthPage({ onAuthenticated }: AuthPageProps) {
	const [mode, setMode] = useState<'login' | 'register'>('login');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError('');
		setLoading(true);
		try {
			onAuthenticated(await authenticate(mode, email, password));
		} catch (requestError) {
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
				<p>Диалоги и документы будут храниться в вашем локальном пространстве.</p>

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
				<button className="auth-card__switch" type="button" onClick={() => setMode((current) => (current === 'login' ? 'register' : 'login'))}>
					{mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
				</button>
			</form>
		</main>
	);
}
