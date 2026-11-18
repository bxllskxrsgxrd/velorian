export const PROFILE_PERIOD_OPTIONS = [
	{ value: '7d', label: '7 дней' },
	{ value: '30d', label: '30 дней' },
	{ value: '90d', label: '90 дней' },
	{ value: 'all', label: 'Всё время' },
] as const;

const PURPOSE_LABELS: Record<string, string> = {
	chat: 'Chat',
	title: 'Title',
	branch_summary: 'Branch Summary',
	memory_extraction: 'Memory Extraction',
	memory: 'Memory Extraction',
	vision: 'Vision',
	file_generation: 'File Generation',
};

export function purposeLabel(purpose: string) {
	return PURPOSE_LABELS[purpose] ?? purpose;
}

export function formatMetric(value: number | null) {
	return value === null ? 'Нет данных' : new Intl.NumberFormat('ru-RU').format(value);
}

export function formatCost(value: string | null) {
	if (value === null) return 'Нет данных';
	const numeric = Number(value);
	return Number.isFinite(numeric)
		? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(numeric)
		: 'Нет данных';
}

export function formatLocalDate(value: string | null) {
	if (!value) return 'Нет данных';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? 'Нет данных' : date.toLocaleString('ru-RU');
}
