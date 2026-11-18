import { useEffect, useState } from 'react';
import { getProfileSecurity } from '../api/profileApi';
import { AnalyticsState, AnalyticsStatus } from '../components/Analytics/AnalyticsUi';
import { ProfileShell } from '../components/Profile/ProfileShell';
import { RoleBadge } from '../components/RoleBadge/RoleBadge';
import type { ProfileSecurity } from '../types/profile';
import { activityEventLabel } from '../utils/activityEventLabels';
import { reportError } from '../utils/reportError';
import { formatLocalDate } from '../utils/profileAnalytics';
import './_profileAnalytics.scss';

export function ProfileSecurityPage() {
	const [security, setSecurity] = useState<ProfileSecurity | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [reload, setReload] = useState(0);

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError(false);
		getProfileSecurity()
			.then((response) => { if (active) setSecurity(response); })
			.catch((loadError: unknown) => {
				if (!active) return;
				setError(true);
				reportError('PROFILE_SECURITY_LOAD_FAILED', loadError);
			})
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [reload]);

	return (
		<ProfileShell section="security" title="Безопасность" description="Доступные сведения о защите и входах в учётную запись">
			<div className="profile-analytics">
				{loading && <AnalyticsState kind="loading">Загрузка сведений безопасности…</AnalyticsState>}
				{!loading && error && (
					<AnalyticsState kind="error" onRetry={() => setReload((value) => value + 1)}>Не удалось загрузить сведения безопасности.</AnalyticsState>
				)}
				{!loading && !error && security && (
					<>
						<section className="profile-analytics__section" aria-labelledby="profile-security-account-title">
							<h3 id="profile-security-account-title">Учётная запись</h3>
							<dl className="profile-analytics__account-grid">
								<div><dt>Логин</dt><dd>{security.account.login}</dd></div>
								<div><dt>Email</dt><dd>{security.account.email}</dd></div>
								<div><dt>Роль</dt><dd><RoleBadge role={security.account.role} /></dd></div>
								<div><dt>Учётная запись создана</dt><dd>{formatLocalDate(security.account.createdAt)}</dd></div>
								<div><dt>Последний успешный вход</dt><dd>{formatLocalDate(security.lastSuccessfulLoginAt)}</dd></div>
							</dl>
						</section>

						<section className="profile-analytics__section" aria-labelledby="profile-security-history-title">
							<h3 id="profile-security-history-title">История входов и выходов</h3>
							{security.authEvents.length === 0 ? <AnalyticsState kind="empty">История входов пока отсутствует.</AnalyticsState> : (
								<div className="profile-analytics__activity-list">
									{security.authEvents.map((event) => (
										<article key={event.id} className="profile-analytics__activity-item">
											<div><strong>{activityEventLabel(event.eventType)}</strong><span>{formatLocalDate(event.createdAt)}</span></div>
											<AnalyticsStatus status={event.status} />
										</article>
									))}
								</div>
							)}
						</section>

						<p className="profile-analytics__security-note">
							Velorian пока не собирает сведения об устройствах, IP-адресах и геолокации и не предоставляет управление паролем или 2FA в этом разделе.
						</p>
					</>
				)}
			</div>
		</ProfileShell>
	);
}
