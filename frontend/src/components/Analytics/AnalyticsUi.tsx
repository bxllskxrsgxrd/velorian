import type { ReactNode } from 'react';
import { Button } from '../ui/Button/Button';
import './_analyticsUi.scss';

export function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
	return (
		<article className="analytics-ui__stat-card">
			<span>{label}</span>
			<strong>{value}</strong>
			{detail && <small>{detail}</small>}
		</article>
	);
}

export function AnalyticsState({
	kind,
	children,
	onRetry,
}: {
	kind: 'loading' | 'empty' | 'error';
	children: ReactNode;
	onRetry?: () => void;
}) {
	return (
		<div
			className={`analytics-ui__state analytics-ui__state--${kind}`}
			role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
		>
			<p>{children}</p>
			{kind === 'error' && onRetry && <Button variant="outline" onClick={onRetry}>Повторить</Button>}
		</div>
	);
}

export function AnalyticsPagination({
	page,
	totalPages,
	onChange,
}: {
	page: number;
	totalPages: number;
	onChange: (page: number) => void;
}) {
	return (
		<div className="analytics-ui__pagination" aria-label="Пагинация">
			<Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>Назад</Button>
			<span>Страница {page} из {Math.max(totalPages, 1)}</span>
			<Button variant="outline" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Вперёд</Button>
		</div>
	);
}

const STATUS_LABELS: Record<string, string> = {
	success: 'Успешно',
	error: 'Ошибка',
	cancelled: 'Отменено',
};

export function AnalyticsStatus({ status }: { status: string }) {
	return (
		<span className={`analytics-ui__status analytics-ui__status--${status}`}>
			{STATUS_LABELS[status] ?? status}
		</span>
	);
}
