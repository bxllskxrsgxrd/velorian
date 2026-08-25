import { describe, expect, it } from 'vitest';
import { getUserErrorMessage } from './userErrorMessages';

describe('getUserErrorMessage', () => {
	it.each([
		['VALIDATION_ERROR', 400], ['AUTH_REQUIRED', 401], ['FORBIDDEN', 403], ['FILE_TOO_LARGE', 413],
		['RATE_LIMITED', 429], ['INTERNAL_ERROR', 500], ['AI_SERVICE_ERROR', 502], ['REQUEST_TIMEOUT', 0],
		['NETWORK_ERROR', 0], ['UNKNOWN_CODE', 0],
	])('returns a safe message for %s', (code, status) => {
		const message = getUserErrorMessage(code, status);
		expect(message.length).toBeGreaterThan(10);
		expect(message).not.toContain('Ошибка сервера:');
	});
});
