import type { AuthUser } from '../types/chat';
import { useUiStore } from '../stores/uiStore';
import { SettingsPanel } from '../components/ChatSidebar/SettingsPanel';

export function SettingsPage({ user }: { user: AuthUser }) {
	const accentTheme = useUiStore((state) => state.accent);
	const setAccent = useUiStore((state) => state.setAccent);

	return <SettingsPanel user={user} accentTheme={accentTheme} onAccentChange={setAccent} />;
}
