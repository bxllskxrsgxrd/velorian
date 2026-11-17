import { Navigate, useLocation } from 'react-router-dom';
import { useUiStore } from '../stores/uiStore';
import { SettingsPanel } from '../components/ChatSidebar/SettingsPanel';

export function SettingsPage() {
	const location = useLocation();
	const accentTheme = useUiStore((state) => state.accent);
	const theme = useUiStore((state) => state.theme);
	const contrast = useUiStore((state) => state.contrast);
	const compactMode = useUiStore((state) => state.compactMode);
	const animations = useUiStore((state) => state.animations);
	const setAccent = useUiStore((state) => state.setAccent);
	const setTheme = useUiStore((state) => state.setTheme);
	const setContrast = useUiStore((state) => state.setContrast);
	const setCompactMode = useUiStore((state) => state.setCompactMode);
	const setAnimations = useUiStore((state) => state.setAnimations);
	const params = new URLSearchParams(location.search);
	const legacySection = params.get('section') ?? params.get('tab');
	if (legacySection === 'account' || location.hash === '#account') {
		return <Navigate to="/profile" replace state={location.state} />;
	}

	return (
		<SettingsPanel
			accentTheme={accentTheme}
			theme={theme}
			contrast={contrast}
			compactMode={compactMode}
			animations={animations}
			onAccentChange={setAccent}
			onThemeChange={setTheme}
			onContrastChange={setContrast}
			onCompactModeChange={setCompactMode}
			onAnimationsChange={setAnimations}
		/>
	);
}
