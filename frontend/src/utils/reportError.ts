export function reportError(scope: string, error: unknown, details?: Record<string, unknown>) {
	const normalizedError = error instanceof Error ? error : new Error(String(error));
	console.groupCollapsed(`[Velorian:${scope}] ${normalizedError.message}`);
	console.error({
		timestamp: new Date().toISOString(),
		scope,
		name: normalizedError.name,
		message: normalizedError.message,
		...details,
	});
	if (normalizedError.stack) console.error(normalizedError.stack);
	console.groupEnd();
}
