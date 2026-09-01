import { create } from 'zustand';
import { getStoredAccentTheme, setAccentTheme, type AccentTheme } from '../theme/accentTheme';
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
	isSidebarOpen: boolean;
	isSidebarCollapsed: boolean;
	showScrollButton: boolean;
	setAccent: (accent: AccentTheme) => void;
	setSidebarOpen: (open: boolean) => void;
	toggleSidebarCollapsed: () => void;
	setShowScrollButton: (show: boolean) => void;
};

export const useUiStore = create<UiStore>((set) => ({
	accent: getStoredAccentTheme(),
	isSidebarOpen: false,
	isSidebarCollapsed: getStoredSidebarCollapsed(),
	showScrollButton: false,
	setAccent: (accent) => {
		setAccentTheme(accent);
		set({ accent });
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
