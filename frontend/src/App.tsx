import { useEffect, useState } from 'react';
import { getCurrentUser, logout } from './api/chatApi';
import { AuthPage } from './components/AuthPage/AuthPage';
import { ChatPage } from './pages/ChatPage';
import type { AuthUser } from './types/chat';

function App() {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		getCurrentUser().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
	}, []);

	if (loading) return <div className="app-loading">Загрузка Velorian…</div>;
	if (!user) return <AuthPage onAuthenticated={setUser} />;

	return (
		<ChatPage
			user={user}
			onLogout={async () => {
				await logout();
				setUser(null);
			}}
		/>
	);
}

export default App;
