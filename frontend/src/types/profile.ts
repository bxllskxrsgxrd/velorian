import type { AuthUser } from './chat';

export type ProfilePeriod = '7d' | '30d' | '90d' | 'all';
export type UsageStatus = 'success' | 'error' | 'cancelled';

export type ProfileUsageTotals = {
	requestCount: number;
	successCount: number;
	errorCount: number;
	cancelledCount: number;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedTokens: number | null;
	totalTokens: number | null;
	knownCostUsd: string | null;
	unknownCostCount: number;
	unknownTokenCount: number;
};

export type ProfileUsageGroup = {
	requestCount: number;
	totalTokens: number | null;
	knownCostUsd: string | null;
	unknownCostCount: number;
};

export type ProfileUsageSummary = {
	period: ProfilePeriod;
	from: string | null;
	totals: ProfileUsageTotals;
	models: Array<ProfileUsageGroup & { provider: string; model: string }>;
	purposes: Array<ProfileUsageGroup & { purpose: string }>;
};

export type ProfileUsageEvent = {
	id: string;
	createdAt: string;
	provider: string;
	model: string;
	purpose: string;
	taskType: string;
	status: UsageStatus;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedTokens: number | null;
	totalTokens: number | null;
	estimatedCostUsd: string | null;
	latencyMs: number;
};

export type ProfileActivityEvent = {
	id: string;
	eventType: string;
	resourceType: string;
	status: string;
	createdAt: string;
};

export type PaginatedResult<T> = {
	events: T[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
};

export type ProfileSecurity = {
	account: AuthUser & { createdAt: string };
	lastSuccessfulLoginAt: string | null;
	authEvents: ProfileActivityEvent[];
};
