import type {
	PaginatedResult,
	ProfileActivityEvent,
	ProfilePeriod,
	ProfileSecurity,
	ProfileUsageEvent,
	ProfileUsageSummary,
	UsageStatus,
} from '../types/profile';
import { requestJson } from './httpClient';

function pageParams(period: ProfilePeriod, page: number, pageSize: number) {
	return new URLSearchParams({ period, page: String(page), pageSize: String(pageSize) });
}

export function getProfileUsage(period: ProfilePeriod) {
	return requestJson<ProfileUsageSummary>(`/profile/usage?period=${period}`);
}

export function getProfileUsageEvents({
	period,
	page,
	pageSize,
	model,
	purpose,
	status,
}: {
	period: ProfilePeriod;
	page: number;
	pageSize: number;
	model?: string;
	purpose?: string;
	status?: UsageStatus | '';
}) {
	const params = pageParams(period, page, pageSize);
	if (model) params.set('model', model);
	if (purpose) params.set('purpose', purpose);
	if (status) params.set('status', status);
	return requestJson<PaginatedResult<ProfileUsageEvent>>(`/profile/usage/events?${params}`);
}

export function getProfileActivity({
	period,
	page,
	pageSize,
	eventType,
}: {
	period: ProfilePeriod;
	page: number;
	pageSize: number;
	eventType?: string;
}) {
	const params = pageParams(period, page, pageSize);
	if (eventType) params.set('eventType', eventType);
	return requestJson<PaginatedResult<ProfileActivityEvent>>(`/profile/activity?${params}`);
}

export function getProfileSecurity() {
	return requestJson<ProfileSecurity>('/profile/security');
}
