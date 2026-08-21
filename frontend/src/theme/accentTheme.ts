import { reportError } from '../utils/reportError';

export const ACCENT_THEMES = ['pine', 'terracotta', 'plum'] as const;

export type AccentTheme = (typeof ACCENT_THEMES)[number];

export const ACCENT_THEME_LABELS: Record<AccentTheme, string> = {
	pine: 'Сосна',
	terracotta: 'Терракота',
	plum: 'Слива',
};

export const DEFAULT_ACCENT_THEME: AccentTheme = 'pine';

const ACCENT_THEME_STORAGE_KEY = 'velorian-accent-theme';

export function isAccentTheme(value: string | null): value is AccentTheme {
	return value !== null && ACCENT_THEMES.some((theme) => theme === value);
}

export function getStoredAccentTheme(): AccentTheme {
	try {
		const storedTheme = window.localStorage.getItem(ACCENT_THEME_STORAGE_KEY);

		return isAccentTheme(storedTheme) ? storedTheme : DEFAULT_ACCENT_THEME;
	} catch (error) {
		reportError('Не удалось прочитать тему из localStorage', error);
		return DEFAULT_ACCENT_THEME;
	}
}

export function setAccentTheme(theme: AccentTheme, persist = true) {
	document.documentElement.dataset.accent = theme;

	if (persist) {
		try {
			window.localStorage.setItem(ACCENT_THEME_STORAGE_KEY, theme);
		} catch (error) {
			reportError('Не удалось сохранить тему в localStorage', error, { theme });
			// Тема всё равно применяется к текущей сессии, даже если storage недоступен.
		}
	}
}

export function initializeAccentTheme() {
	setAccentTheme(getStoredAccentTheme(), false);
}
