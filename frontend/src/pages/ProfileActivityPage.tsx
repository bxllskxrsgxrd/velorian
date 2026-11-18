import { useEffect, useState } from 'react';
import { getProfileActivity } from '../api/profileApi';
import { AnalyticsPagination, AnalyticsState, AnalyticsStatus } from '../components/Analytics/AnalyticsUi';
import { ProfileShell } from '../components/Profile/ProfileShell';
import { CustomSelect } from '../components/ui/CustomSelect/CustomSelect';
import type { PaginatedResult, ProfileActivityEvent, ProfilePeriod } from '../types/profile';
import { ACTIVITY_EVENT_OPTIONS, activityEventLabel, activityResourceLabel } from '../utils/activityEventLabels';
import { reportError } from '../utils/reportError';
import { formatLocalDate, PROFILE_PERIOD_OPTIONS } from '../utils/profileAnalytics';
import './_profileAnalytics.scss';

const PAGE_SIZE = 20;

export function ProfileActivityPage() {
	const [period, setPeriod] = useState<ProfilePeriod>('30d');
	const [eventType, setEventType] = useState('');
	const [page, setPage] = useState(1);
	const [result, setResult] = useState<PaginatedResult<ProfileActivityEvent> | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [reload, setReload] = useState(0);

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError(false);
		getProfileActivity({ period, page, pageSize: PAGE_SIZE, eventType })
			.then((response) => { if (active) setResult(response); })
			.catch((loadError: unknown) => {
				if (!active) return;
				setError(true);
				reportError('PROFILE_ACTIVITY_LOAD_FAILED', loadError, { period, page, eventType });
			})
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [eventType, page, period, reload]);

	return (
		<ProfileShell section="activity" title="Активность" description="История значимых действий в вашей учётной записи">
			<div className="profile-analytics">
				<div className="profile-analytics__filters profile-analytics__filters--activity">
					<CustomSelect
						value={period}
						options={PROFILE_PERIOD_OPTIONS}
						onChange={(value) => { setPage(1); setPeriod(value as ProfilePeriod); }}
						ariaLabel="Период активности"
					/>
					<CustomSelect
						value={eventType}
						options={[{ value: '', label: 'Все действия' }, ...ACTIVITY_EVENT_OPTIONS]}
						onChange={(value) => { setPage(1); setEventType(value); }}
						ariaLabel="Фильтр по типу действия"
					/>
				</div>
				{loading && <AnalyticsState kind="loading">Загрузка активности…</AnalyticsState>}
				{!loading && error && (
					<AnalyticsState kind="error" onRetry={() => setReload((value) => value + 1)}>Не удалось загрузить активность.</AnalyticsState>
				)}
				{!loading && !error && result?.events.length === 0 && <AnalyticsState kind="empty">За выбранный период событий нет.</AnalyticsState>}
				{!loading && !error && result && result.events.length > 0 && (
					<>
						<div className="profile-analytics__activity-list">
							{result.events.map((event) => (
								<article key={event.id} className="profile-analytics__activity-item">
									<div>
										<strong>{activityEventLabel(event.eventType)}</strong>
										<span>{formatLocalDate(event.createdAt)}</span>
									</div>
									<div>
										<span>{activityResourceLabel(event.resourceType)}</span>
										<AnalyticsStatus status={event.status} />
									</div>
								</article>
							))}
						</div>
						<AnalyticsPagination page={result.page} totalPages={result.totalPages} onChange={setPage} />
					</>
				)}
			</div>
		</ProfileShell>
	);
}
