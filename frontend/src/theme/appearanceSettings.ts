import { reportError } from '../utils/reportError';

export const THEME_PREFERENCES = ['system', 'dark', 'light'] as const;
export const CONTRAST_PREFERENCES = ['system', 'standard', 'high'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ContrastPreference = (typeof CONTRAST_PREFERENCES)[number];
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const DEFAULT_CONTRAST_PREFERENCE: ContrastPreference = 'system';

const THEME_STORAGE_KEY = 'velorian-theme';
const CONTRAST_STORAGE_KEY = 'velorian-contrast';
const COMPACT_MODE_STORAGE_KEY = 'velorian-compact-mode';
const ANIMATIONS_STORAGE_KEY = 'velorian-animations';
const DARK_THEME_QUERY = '(prefers-color-scheme: dark)';
const HIGH_CONTRAST_QUERY = '(prefers-contrast: more)';

let systemThemeListenerInitialized = false;
let systemContrastListenerInitialized = false;

function isThemePreference(value: unknown): value is ThemePreference {
	return typeof value === 'string' && THEME_PREFERENCES.some((item) => item === value);
}

function isContrastPreference(value: unknown): value is ContrastPreference {
	return typeof value === 'string' && CONTRAST_PREFERENCES.some((item) => item === value);
}

function systemMatches(query: string) {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

function resolveTheme(theme: ThemePreference) {
	if (theme !== 'system') return theme;
	return systemMatches(DARK_THEME_QUERY) ? 'dark' : 'light';
}

function resolveContrast(contrast: ContrastPreference) {
	if (contrast !== 'system') return contrast;
	return systemMatches(HIGH_CONTRAST_QUERY) ? 'high' : 'standard';
}

export function getStoredThemePreference(): ThemePreference {
	if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCE;

	try {
		const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(storedValue) ? storedValue : DEFAULT_THEME_PREFERENCE;
	} catch (error) {
		reportError('Не удалось прочитать настройку темы', error);
		return DEFAULT_THEME_PREFERENCE;
	}
}

export function getStoredContrastPreference(): ContrastPreference {
	if (typeof window === 'undefined') return DEFAULT_CONTRAST_PREFERENCE;

	try {
		const storedValue = window.localStorage.getItem(CONTRAST_STORAGE_KEY);
		return isContrastPreference(storedValue) ? storedValue : DEFAULT_CONTRAST_PREFERENCE;
	} catch (error) {
		reportError('Не удалось прочитать настройку контраста', error);
		return DEFAULT_CONTRAST_PREFERENCE;
	}
}

export function getStoredCompactMode() {
	if (typeof window === 'undefined') return false;

	try {
		return window.localStorage.getItem(COMPACT_MODE_STORAGE_KEY) === 'true';
	} catch (error) {
		reportError('Не удалось прочитать настройку компактного режима', error);
		return false;
	}
}

export function getStoredAnimations() {
	if (typeof window === 'undefined') return true;

	try {
		return window.localStorage.getItem(ANIMATIONS_STORAGE_KEY) !== 'false';
	} catch (error) {
		reportError('Не удалось прочитать настройку анимаций', error);
		return true;
	}
}

export function applyThemePreference(theme: ThemePreference, persist = true) {
	if (typeof document !== 'undefined') {
		const root = document.documentElement;
		root.dataset.theme = resolveTheme(theme);
		root.dataset.themePreference = theme;
	}

	if (persist && typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, theme);
		} catch (error) {
			reportError('Не удалось сохранить настройку темы', error, { theme });
		}
	}
}

export function applyContrastPreference(contrast: ContrastPreference, persist = true) {
	if (typeof document !== 'undefined') {
		const root = document.documentElement;
		root.dataset.contrast = resolveContrast(contrast);
		root.dataset.contrastPreference = contrast;
	}

	if (persist && typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(CONTRAST_STORAGE_KEY, contrast);
		} catch (error) {
			reportError('Не удалось сохранить настройку контраста', error, { contrast });
		}
	}
}

export function applyCompactMode(compactMode: boolean, persist = true) {
	if (typeof document !== 'undefined') {
		document.documentElement.dataset.compact = String(compactMode);
	}

	if (persist && typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(COMPACT_MODE_STORAGE_KEY, String(compactMode));
		} catch (error) {
			reportError('Не удалось сохранить настройку компактного режима', error, { compactMode });
		}
	}
}

export function applyAnimations(animations: boolean, persist = true) {
	if (typeof document !== 'undefined') {
		document.documentElement.dataset.animations = animations ? 'on' : 'off';
	}

	if (persist && typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(ANIMATIONS_STORAGE_KEY, String(animations));
		} catch (error) {
			reportError('Не удалось сохранить настройку анимаций', error, { animations });
		}
	}
}

export function initializeThemePreference() {
	applyThemePreference(getStoredThemePreference(), false);

	if (systemThemeListenerInitialized || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

	const handleSystemPreferenceChange = () => applyThemePreference(getStoredThemePreference(), false);
	window.matchMedia(DARK_THEME_QUERY).addEventListener('change', handleSystemPreferenceChange);
	systemThemeListenerInitialized = true;
}

export function initializeContrastPreference() {
	applyContrastPreference(getStoredContrastPreference(), false);

	if (systemContrastListenerInitialized || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

	const handleSystemPreferenceChange = () => applyContrastPreference(getStoredContrastPreference(), false);
	window.matchMedia(HIGH_CONTRAST_QUERY).addEventListener('change', handleSystemPreferenceChange);
	systemContrastListenerInitialized = true;
}

export function initializeCompactMode() {
	applyCompactMode(getStoredCompactMode(), false);
}

export function initializeAnimations() {
	applyAnimations(getStoredAnimations(), false);
}
