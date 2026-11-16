import { create } from 'zustand';
import { getStoredAccentTheme, setAccentTheme, type AccentTheme } from '../theme/accentTheme';
import {
	applyAnimations,
	applyCompactMode,
	applyContrastPreference,
	applyThemePreference,
	getStoredAnimations,
	getStoredCompactMode,
	getStoredContrastPreference,
	getStoredThemePreference,
	type ContrastPreference,
	type ThemePreference,
} from '../theme/appearanceSettings';
import { reportError } from '../utils/reportError';

const SIDEBAR_STORAGE_KEY = 'velorian-sidebar-collapsed';

function getStoredSidebarCollapsed() {
	try {
		return typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
	} catch (error) {
		reportError('Не удалось прочитать состояние боковой панели', error);
		return false;
	}
}

type UiStore = {
	accent: AccentTheme;
	theme: ThemePreference;
	contrast: ContrastPreference;
	compactMode: boolean;
	animations: boolean;
	isSidebarOpen: boolean;
	isSidebarCollapsed: boolean;
	showScrollButton: boolean;
	setAccent: (accent: AccentTheme) => void;
	setTheme: (theme: ThemePreference) => void;
	setContrast: (contrast: ContrastPreference) => void;
	setCompactMode: (compactMode: boolean) => void;
	setAnimations: (animations: boolean) => void;
	setSidebarOpen: (open: boolean) => void;
	toggleSidebarCollapsed: () => void;
	setShowScrollButton: (show: boolean) => void;
};

export const useUiStore = create<UiStore>((set) => ({
	accent: getStoredAccentTheme(),
	theme: getStoredThemePreference(),
	contrast: getStoredContrastPreference(),
	compactMode: getStoredCompactMode(),
	animations: getStoredAnimations(),
	isSidebarOpen: false,
	isSidebarCollapsed: getStoredSidebarCollapsed(),
	showScrollButton: false,
	setAccent: (accent) => {
		setAccentTheme(accent);
		set({ accent });
	},
	setTheme: (theme) => {
		applyThemePreference(theme);
		set({ theme });
	},
	setContrast: (contrast) => {
		applyContrastPreference(contrast);
		set({ contrast });
	},
	setCompactMode: (compactMode) => {
		applyCompactMode(compactMode);
		set({ compactMode });
	},
	setAnimations: (animations) => {
		applyAnimations(animations);
		set({ animations });
	},
	setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
	toggleSidebarCollapsed: () =>
		set((state) => {
			const isSidebarCollapsed = !state.isSidebarCollapsed;
			try {
				window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
			} catch (error) {
				reportError('Не удалось сохранить состояние боковой панели', error);
			}
			return { isSidebarCollapsed };
		}),
	setShowScrollButton: (showScrollButton) => set({ showScrollButton }),
}));
