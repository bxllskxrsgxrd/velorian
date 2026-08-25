import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUser, logout } from './api/chatApi';
import { AuthPage } from './components/AuthPage/AuthPage';
import { ChatPage } from './pages/ChatPage';
import type { AuthUser } from './types/chat';
import { reportError } from './utils/reportError';

const KnowledgePage = lazy(() => import('./pages/KnowledgePage'));

function App() {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		getCurrentUser()
			.then(setUser)
			.catch((error: unknown) => {
				reportError('Не удалось восстановить сессию', error);
				setUser(null);
			})
			.finally(() => setLoading(false));
	}, []);

	if (loading) return <div className="app-loading">Загрузка Velorian…</div>;
	if (!user) return <AuthPage onAuthenticated={setUser} />;
	const handleLogout = async () => { await logout(); setUser(null); navigate('/'); };
	const initialConversationId = new URLSearchParams(location.search).get('conversation') ?? undefined;

	return <Suspense fallback={<div className="app-loading">Загрузка раздела…</div>}><Routes>
		<Route path="/" element={<ChatPage user={user} onLogout={handleLogout} onOpenKnowledge={() => navigate('/knowledge')} initialConversationId={initialConversationId} />} />
		<Route path="/knowledge" element={<KnowledgePage user={user} onLogout={handleLogout} />} />
		<Route path="*" element={<Navigate to="/" replace />} />
	</Routes></Suspense>;
}

export default App;
