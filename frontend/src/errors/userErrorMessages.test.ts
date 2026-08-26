import { describe, expect, it } from 'vitest';
import { getUserErrorMessage, getUserFacingError } from './userErrorMessages';

describe('getUserErrorMessage', () => {
	it.each([
		['VALIDATION_ERROR', 400], ['AUTH_REQUIRED', 401], ['FORBIDDEN', 403], ['FILE_SIZE_LIMIT_EXCEEDED', 413],
		['RATE_LIMITED', 429], ['INTERNAL_ERROR', 500], ['AI_SERVICE_ERROR', 502], ['REQUEST_TIMEOUT', 0],
		['NETWORK_ERROR', 0], ['UNKNOWN_CODE', 0],
	])('returns a safe message for %s', (code, status) => {
		const message = getUserErrorMessage(code, status);
		expect(message.length).toBeGreaterThan(10);
		expect(message).not.toContain('Ошибка сервера:');
	});

	it('maps attachment limit codes to specific user-facing copy', () => {
		expect(getUserFacingError('ATTACHMENT_COUNT_LIMIT_EXCEEDED')).toMatchObject({ title: 'Слишком много файлов', retryable: false });
		expect(getUserFacingError('ATTACHMENT_COUNT_LIMIT_EXCEEDED').description).toContain('10');
		expect(getUserFacingError('ATTACHMENTS_TOTAL_SIZE_LIMIT_EXCEEDED').title).toBe('Превышен общий размер вложений');
	});

	it('normalizes title, description and retry policy independently', () => {
		expect(getUserFacingError('AI_PROVIDER_UNAVAILABLE', 502, 'request-1')).toEqual({
			code: 'AI_PROVIDER_UNAVAILABLE',
			title: 'Не удалось получить ответ',
			description: expect.stringContaining('временно недоступен'),
			requestId: 'request-1',
			retryable: true,
		});
		expect(getUserFacingError('FORBIDDEN', 403).retryable).toBe(false);
	});
});
