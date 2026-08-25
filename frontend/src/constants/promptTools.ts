import type { SearchMode } from '../types/chat';

export const PROMPT_TOOLS: Record<Exclude<SearchMode, 'none'>, { label: string; activeLabel: string; marker: string }> = {
	web: { label: 'Поиск в сети', activeLabel: 'Отключить поиск в сети', marker: '🌐 Поиск в сети' },
	knowledge: { label: 'Поиск по базе знаний', activeLabel: 'Отключить поиск по базе знаний', marker: '◈ Поиск по базе знаний' },
};

export function promptMarker(mode: SearchMode) {
	return mode === 'none' ? '' : `${PROMPT_TOOLS[mode].marker} `;
}

export function stripPromptMarker(value: string, mode: SearchMode) {
	if (mode === 'none') return value;
	const marker = PROMPT_TOOLS[mode].marker;
	if (value.startsWith(`${marker} `)) return value.slice(marker.length + 1);
	if (value.startsWith(marker)) return value.slice(marker.length);
	return value;
}
