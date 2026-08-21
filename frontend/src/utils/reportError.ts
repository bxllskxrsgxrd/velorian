export function reportError(scope: string, error: unknown, details?: Record<string, unknown>) {
	const normalizedError = error instanceof Error ? error : new Error(String(error));
	console.error(`[Velorian] ${scope}`, normalizedError, details ?? {});
}
