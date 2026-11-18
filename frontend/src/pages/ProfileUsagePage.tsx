import { useEffect, useMemo, useState } from 'react';
import { getProfileUsage, getProfileUsageEvents } from '../api/profileApi';
import {
	AnalyticsPagination,
	AnalyticsState,
	AnalyticsStatus,
	StatCard,
} from '../components/Analytics/AnalyticsUi';
import { ProfileShell } from '../components/Profile/ProfileShell';
import { CustomSelect } from '../components/ui/CustomSelect/CustomSelect';
import type { PaginatedResult, ProfilePeriod, ProfileUsageEvent, ProfileUsageSummary, UsageStatus } from '../types/profile';
import { reportError } from '../utils/reportError';
import { formatCost, formatLocalDate, formatMetric, PROFILE_PERIOD_OPTIONS, purposeLabel } from '../utils/profileAnalytics';
import './_profileAnalytics.scss';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
	{ value: '', label: 'Все статусы' },
	{ value: 'success', label: 'Успешно' },
	{ value: 'error', label: 'Ошибка' },
	{ value: 'cancelled', label: 'Отменено' },
];

export function ProfileUsagePage() {
	const [period, setPeriod] = useState<ProfilePeriod>('30d');
	const [summary, setSummary] = useState<ProfileUsageSummary | null>(null);
	const [summaryLoading, setSummaryLoading] = useState(true);
	const [summaryError, setSummaryError] = useState(false);
	const [summaryReload, setSummaryReload] = useState(0);
	const [history, setHistory] = useState<PaginatedResult<ProfileUsageEvent> | null>(null);
	const [historyLoading, setHistoryLoading] = useState(true);
	const [historyError, setHistoryError] = useState(false);
	const [historyReload, setHistoryReload] = useState(0);
	const [page, setPage] = useState(1);
	const [model, setModel] = useState('');
	const [purpose, setPurpose] = useState('');
	const [status, setStatus] = useState<UsageStatus | ''>('');

	useEffect(() => {
		let active = true;
		setSummaryLoading(true);
		setSummaryError(false);
		getProfileUsage(period)
			.then((result) => { if (active) setSummary(result); })
			.catch((error: unknown) => {
				if (!active) return;
				setSummaryError(true);
				reportError('PROFILE_USAGE_LOAD_FAILED', error, { period });
			})
			.finally(() => { if (active) setSummaryLoading(false); });
		return () => { active = false; };
	}, [period, summaryReload]);

	useEffect(() => {
		let active = true;
		setHistoryLoading(true);
		setHistoryError(false);
		getProfileUsageEvents({ period, page, pageSize: PAGE_SIZE, model, purpose, status })
			.then((result) => { if (active) setHistory(result); })
			.catch((error: unknown) => {
				if (!active) return;
				setHistoryError(true);
				reportError('PROFILE_USAGE_EVENTS_LOAD_FAILED', error, { period, page, model, purpose, status });
			})
			.finally(() => { if (active) setHistoryLoading(false); });
		return () => { active = false; };
	}, [historyReload, model, page, period, purpose, status]);

	const modelOptions = useMemo(() => {
		const models = new Map<string, string>();
		(summary?.models ?? []).forEach((item) => {
			if (!models.has(item.model)) models.set(item.model, `${item.model} · ${item.provider}`);
		});
		return [{ value: '', label: 'Все модели' }, ...[...models].map(([value, label]) => ({ value, label }))];
	}, [summary]);
	const purposeOptions = useMemo(() => [
		{ value: '', label: 'Все типы' },
		...(summary?.purposes ?? []).map((item) => ({ value: item.purpose, label: purposeLabel(item.purpose) })),
	], [summary]);

	function changePeriod(value: string) {
		setPage(1);
		setPeriod(value as ProfilePeriod);
	}

	function changeFilter(setter: (value: string) => void, value: string) {
		setPage(1);
		setter(value);
	}

	return (
		<ProfileShell section="usage" title="Использование AI" description="Персональная статистика фактических AI-вызовов">
			<div className="profile-analytics">
				<div className="profile-analytics__toolbar">
					<label><span>Период</span><CustomSelect value={period} options={PROFILE_PERIOD_OPTIONS} onChange={changePeriod} ariaLabel="Период статистики" /></label>
				</div>

				{summaryLoading && <AnalyticsState kind="loading">Загрузка статистики…</AnalyticsState>}
				{!summaryLoading && summaryError && (
					<AnalyticsState kind="error" onRetry={() => setSummaryReload((value) => value + 1)}>Не удалось загрузить статистику.</AnalyticsState>
				)}
				{!summaryLoading && !summaryError && summary && (
					<>
						<div className="profile-analytics__stats">
							<StatCard
								label="AI-запросы"
								value={formatMetric(summary.totals.requestCount)}
								detail={`${summary.totals.successCount} успешно · ${summary.totals.errorCount} ошибок · ${summary.totals.cancelledCount} отменено`}
							/>
							<StatCard label="Входные токены" value={formatMetric(summary.totals.inputTokens)} />
							<StatCard label="Выходные токены" value={formatMetric(summary.totals.outputTokens)} />
							<StatCard
								label="Всего токенов"
								value={formatMetric(summary.totals.totalTokens)}
								detail={`Cached: ${formatMetric(summary.totals.cachedTokens)}${summary.totals.unknownTokenCount > 0 ? ` · ${summary.totals.unknownTokenCount} выз. без usage` : ''}`}
							/>
							<StatCard
								label="Ориентировочные расходы"
								value={formatCost(summary.totals.knownCostUsd)}
								detail={summary.totals.unknownCostCount > 0 ? `${summary.totals.unknownCostCount} выз. без данных о стоимости` : undefined}
							/>
						</div>

						<section className="profile-analytics__section" aria-labelledby="profile-model-usage-title">
							<h3 id="profile-model-usage-title">Использование моделей</h3>
							{summary.models.length === 0 ? <AnalyticsState kind="empty">За выбранный период вызовов нет.</AnalyticsState> : (
								<div className="profile-analytics__table-wrap"><table className="profile-analytics__table">
									<thead><tr><th>Модель</th><th>Провайдер</th><th>Запросы</th><th>Токены</th><th>Стоимость</th></tr></thead>
									<tbody>{summary.models.map((item) => (
										<tr key={`${item.provider}:${item.model}`}>
											<td data-label="Модель"><strong>{item.model}</strong></td>
											<td data-label="Провайдер">{item.provider}</td>
											<td data-label="Запросы">{formatMetric(item.requestCount)}</td>
											<td data-label="Токены">{formatMetric(item.totalTokens)}</td>
											<td data-label="Стоимость">{formatCost(item.knownCostUsd)}{item.unknownCostCount > 0 && <small> Частично</small>}</td>
										</tr>
									))}</tbody>
								</table></div>
							)}
						</section>

						<section className="profile-analytics__section" aria-labelledby="profile-purpose-usage-title">
							<h3 id="profile-purpose-usage-title">Распределение по типам</h3>
							{summary.purposes.length === 0 ? <AnalyticsState kind="empty">Данных по типам пока нет.</AnalyticsState> : (
								<div className="profile-analytics__table-wrap"><table className="profile-analytics__table">
									<thead><tr><th>Тип</th><th>Запросы</th><th>Токены</th><th>Стоимость</th></tr></thead>
									<tbody>{summary.purposes.map((item) => (
										<tr key={item.purpose}>
											<td data-label="Тип"><strong>{purposeLabel(item.purpose)}</strong></td>
											<td data-label="Запросы">{formatMetric(item.requestCount)}</td>
											<td data-label="Токены">{formatMetric(item.totalTokens)}</td>
											<td data-label="Стоимость">{formatCost(item.knownCostUsd)}{item.unknownCostCount > 0 && <small> Частично</small>}</td>
										</tr>
									))}</tbody>
								</table></div>
							)}
						</section>
					</>
				)}

				<section className="profile-analytics__section" aria-labelledby="profile-usage-history-title">
					<h3 id="profile-usage-history-title">История AI-запросов</h3>
					<div className="profile-analytics__filters">
						<CustomSelect value={model} options={modelOptions} onChange={(value) => changeFilter(setModel, value)} ariaLabel="Фильтр по модели" />
						<CustomSelect value={purpose} options={purposeOptions} onChange={(value) => changeFilter(setPurpose, value)} ariaLabel="Фильтр по типу запроса" />
						<CustomSelect value={status} options={STATUS_OPTIONS} onChange={(value) => changeFilter((next) => setStatus(next as UsageStatus | ''), value)} ariaLabel="Фильтр по статусу" />
					</div>
					{historyLoading && <AnalyticsState kind="loading">Загрузка истории…</AnalyticsState>}
					{!historyLoading && historyError && (
						<AnalyticsState kind="error" onRetry={() => setHistoryReload((value) => value + 1)}>Не удалось загрузить историю AI-запросов.</AnalyticsState>
					)}
					{!historyLoading && !historyError && history?.events.length === 0 && <AnalyticsState kind="empty">AI-запросы не найдены.</AnalyticsState>}
					{!historyLoading && !historyError && history && history.events.length > 0 && (
						<>
							<div className="profile-analytics__table-wrap"><table className="profile-analytics__table">
								<thead><tr><th>Дата</th><th>Модель</th><th>Тип запроса</th><th>Токены</th><th>Стоимость</th><th>Статус</th></tr></thead>
								<tbody>{history.events.map((event) => (
									<tr key={event.id}>
										<td data-label="Дата">{formatLocalDate(event.createdAt)}</td>
										<td data-label="Модель"><strong>{event.model}</strong><small>{event.provider}</small></td>
										<td data-label="Тип запроса">{purposeLabel(event.purpose)}</td>
										<td data-label="Токены">{formatMetric(event.totalTokens)}</td>
										<td data-label="Стоимость">{formatCost(event.estimatedCostUsd)}</td>
										<td data-label="Статус"><AnalyticsStatus status={event.status} /></td>
									</tr>
								))}</tbody>
							</table></div>
							<AnalyticsPagination page={history.page} totalPages={history.totalPages} onChange={setPage} />
						</>
					)}
				</section>
			</div>
		</ProfileShell>
	);
}
