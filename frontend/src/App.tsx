import { useEffect, useState } from 'react';
import { getCurrentUser, logout } from './api/chatApi';
import { AuthPage } from './components/AuthPage/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { KnowledgePage } from './pages/KnowledgePage';
import type { AuthUser } from './types/chat';
import { reportError } from './utils/reportError';

function App() {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);
	const [path, setPath] = useState(window.location.pathname);

	useEffect(() => {
		getCurrentUser()
			.then(setUser)
			.catch((error: unknown) => {
				reportError('Не удалось восстановить сессию', error);
				setUser(null);
			})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		const handlePopState = () => setPath(window.location.pathname);
		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	}, []);

	function navigate(nextPath: string) {
		window.history.pushState({}, '', nextPath);
		setPath(nextPath);
	}

	if (loading) return <div className="app-loading">Загрузка Velorian…</div>;
	if (!user) return <AuthPage onAuthenticated={setUser} />;
	if (path === '/knowledge') return <KnowledgePage user={user} onBack={() => navigate('/')} />;

	return (
		<ChatPage
			user={user}
			onLogout={async () => {
				await logout();
				setUser(null);
			}}
			onOpenKnowledge={() => navigate('/knowledge')}
		/>
	);
}

export default App;
