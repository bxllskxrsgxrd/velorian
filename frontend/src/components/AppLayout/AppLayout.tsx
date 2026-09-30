import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { deleteConversation, listConversations, renameConversation } from '../../api/chatApi';
import { useChatStore } from '../../stores/chatStore';
import { useConversationsStore } from '../../stores/conversationsStore';
import { useFilesStore } from '../../stores/filesStore';
import { usePromptStore } from '../../stores/promptStore';
import { useUiStore } from '../../stores/uiStore';
import type { AuthUser, ConversationSummary } from '../../types/chat';
import { reportError } from '../../utils/reportError';
import { useToast } from '../../hooks/useToast';
import { ChatSidebar } from '../ChatSidebar/ChatSidebar';
import { FilePreviewModal } from '../FilePreviewModal/FilePreviewModal';

function downloadText(name: string, content: string, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

export function AppLayout({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
	const navigate = useNavigate();
	const location = useLocation();
	const conversations = useConversationsStore((state) => state.conversations);
	const setConversations = useConversationsStore((state) => state.setConversations);
	const removeConversationState = useChatStore((state) => state.removeConversationState);
	const previewFile = useFilesStore((state) => state.previewFile);
	const setPreviewFile = useFilesStore((state) => state.setPreviewFile);
	const clearFiles = useFilesStore((state) => state.clearFiles);
	const resetPrompt = usePromptStore((state) => state.reset);
	const sidebarOpen = useUiStore((state) => state.isSidebarOpen);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const chatMatch = location.pathname.match(/^\/chat\/([^/]+)$/);
	const activeConversationId = chatMatch && chatMatch[1] !== 'new' ? decodeURIComponent(chatMatch[1]) : null;
	const activeSection = location.pathname.startsWith('/knowledge') ? 'knowledge' : 'chat';
	const { showToast } = useToast();

	useEffect(() => {
		let cancelled = false;
		listConversations()
			.then((items) => { if (!cancelled) setConversations(items); })
			.catch((error: unknown) => reportError('Не удалось загрузить историю диалогов', error));
		return () => { cancelled = true; };
	}, [setConversations, user.id]);

	useEffect(() => () => {
		const current = useFilesStore.getState().previewFile;
		if (current?.revokeOnClose) URL.revokeObjectURL(current.url);
	}, []);

	function closePreview() {
		if (previewFile?.revokeOnClose) URL.revokeObjectURL(previewFile.url);
		setPreviewFile(null);
	}

	function handleNew() {
		clearFiles();
		resetPrompt();
		setSidebarOpen(false);
		navigate('/chat/new');
		requestAnimationFrame(() => {
			const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Введите запрос"]');
			if (!textarea?.disabled) textarea.focus({ preventScroll: true });
		});
	}

	async function handleDelete(id: string) {
		await deleteConversation(id);
		const remaining = conversations.filter((item) => item.id !== id);
		setConversations(remaining);
		removeConversationState(id);
		if (activeConversationId === id) navigate(remaining[0] ? `/chat/${remaining[0].id}` : '/chat/new', { replace: true });
	}

	async function handleRename(conversation: ConversationSummary, title: string) {
		if (title === conversation.title) return;
		const updated = await renameConversation(conversation.id, title);
		setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
	}

	function handleExport(format: 'markdown' | 'json') {
		if (!activeConversationId) return;
		const messages = useChatStore.getState().messagesByConversation[activeConversationId] ?? [];
		if (!messages.length) return;
		const active = conversations.find((item) => item.id === activeConversationId);
		const safeName = (active?.title ?? 'velorian-dialog').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60);
		if (format === 'json') {
			downloadText(`${safeName}.json`, JSON.stringify({ conversation: active, messages }, null, 2), 'application/json');
			return;
		}
		const markdown = messages.map((message) => `## ${message.role === 'user' ? 'Вы' : 'Velorian'}\n\n${message.content}\n`).join('\n');
		downloadText(`${safeName}.md`, `# ${active?.title ?? 'Диалог'}\n\n${markdown}`, 'text/markdown');
	}

	return (
		<div className="app-shell">
			<ChatSidebar
				user={user}
				activeConversationId={activeConversationId}
				activeSection={activeSection}
				onSelect={(id) => { navigate(`/chat/${encodeURIComponent(id)}`); setSidebarOpen(false); }}
				onNew={handleNew}
				onDelete={(id) => void handleDelete(id).catch((error: unknown) => {
					reportError('Не удалось удалить диалог', error, { conversationId: id });
					showToast(error instanceof Error ? error.message : 'Не удалось удалить диалог', 'error');
				})}
				onRename={(conversation, title) => void handleRename(conversation, title).catch((error: unknown) => {
					reportError('Не удалось переименовать диалог', error, { conversationId: conversation.id });
					showToast(error instanceof Error ? error.message : 'Не удалось переименовать диалог', 'error');
				})}
				onLogout={() => void onLogout()}
				onOpenKnowledge={() => { navigate('/knowledge'); setSidebarOpen(false); }}
				onOpenSettings={() => navigate('/settings', {
					state: { from: `${location.pathname}${location.search}${location.hash}` },
				})}
			/>
			<Outlet context={{ onExport: handleExport }} />
			{sidebarOpen && (
				<button className="chat-shell__backdrop" type="button" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню" />
			)}
			{previewFile && <FilePreviewModal file={previewFile} onClose={closePreview} />}
		</div>
	);
}
