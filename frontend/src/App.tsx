import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUser, getRuntimeConfig, logout } from './api/chatApi';
import { AuthPage } from './components/AuthPage/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { AppLayout } from './components/AppLayout/AppLayout';
import { reportError } from './utils/reportError';
import { configureAttachmentLimits } from './constants/attachmentLimits';
import { useAuthStore } from './stores/authStore';
import { SettingsPage } from './pages/SettingsPage';

const KnowledgePage = lazy(() => import('./pages/KnowledgePage'));
const KnowledgeEditorPage = lazy(() => import('./pages/KnowledgeEditorPage').then((module) => ({ default: module.KnowledgeEditorPage })));
const ApproachesPage = lazy(() => import('./pages/ApproachesPage').then((module) => ({ default: module.ApproachesPage })));
const ApproachEditorPage = lazy(() => import('./pages/ApproachEditorPage').then((module) => ({ default: module.ApproachEditorPage })));

function App() {
	const user = useAuthStore((state) => state.user);
	const loading = useAuthStore((state) => state.isSessionLoading);
	const setUser = useAuthStore((state) => state.setUser);
	const setLoading = useAuthStore((state) => state.setSessionLoading);
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		Promise.all([
			getCurrentUser(),
			getRuntimeConfig().catch((error: unknown) => {
				reportError('Не удалось загрузить лимиты вложений', error);
				return null;
			}),
		])
			.then(([currentUser, config]) => {
				if (config) configureAttachmentLimits(config.attachmentLimits);
				setUser(currentUser);
			})
			.catch((error: unknown) => {
				reportError('Не удалось восстановить сессию', error);
				setUser(null);
			})
			.finally(() => setLoading(false));
	}, [setLoading, setUser]);

	if (loading) return <div className="app-loading">Загрузка Velorian…</div>;
	if (!user) return <AuthPage onAuthenticated={setUser} />;
	const handleLogout = async () => { await logout(); setUser(null); navigate('/'); };
	const legacyConversationId = new URLSearchParams(location.search).get('conversation');

	return <Suspense fallback={<div className="app-loading">Загрузка раздела…</div>}><Routes>
		<Route path="/" element={<Navigate to={legacyConversationId ? `/chat/${encodeURIComponent(legacyConversationId)}` : '/chat/new'} replace />} />
		<Route element={<AppLayout user={user} onLogout={handleLogout} />}>
			<Route path="/chat/new" element={<ChatPage />} />
			<Route path="/chat/:chatId" element={<ChatPage />} />
			<Route path="/chats/:conversationId" element={<Navigate to={`/chat/${location.pathname.split('/').pop() ?? 'new'}`} replace />} />
			<Route path="/knowledge" element={<KnowledgePage user={user} />} />
			<Route path="/knowledge/new" element={<KnowledgeEditorPage />} />
			<Route path="/knowledge/approaches" element={<ApproachesPage />} />
			<Route path="/knowledge/approaches/new" element={<ApproachEditorPage />} />
			<Route path="/knowledge/approaches/:approachId" element={<ApproachEditorPage />} />
			<Route path="/knowledge/:knowledgeId" element={<KnowledgeEditorPage />} />
		</Route>
		<Route path="/settings" element={<SettingsPage user={user} />} />
		<Route path="*" element={<Navigate to="/chat/new" replace />} />
	</Routes></Suspense>;
}

export default App;
