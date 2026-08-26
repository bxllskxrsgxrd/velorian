import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTACHMENT_LIMITS, MAX_ATTACHMENTS } from '../constants/attachmentLimits';
import { validateAndMergeFiles } from './fileValidation';

function file(name: string, size = 4) {
	return new File([new Uint8Array(size)], name);
}

describe('validateAndMergeFiles', () => {
	it('accepts supported files', () => {
		const result = validateAndMergeFiles([], [file('notes.txt'), file('photo.jpg')]);
		expect(result.error).toBeUndefined();
		expect(result.files).toHaveLength(2);
	});

	it('rejects unsupported extensions without changing current files', () => {
		const current = [file('notes.txt')];
		const result = validateAndMergeFiles(current, [file('archive.exe')]);
		expect(result.files).toBe(current);
		expect(result.error?.code).toBe('UNSUPPORTED_FILE_TYPE');
	});

	it('rejects a file over the size limit', () => {
		const result = validateAndMergeFiles([], [file('huge.pdf', DEFAULT_ATTACHMENT_LIMITS.maxFileSize + 1)]);
		expect(result.files).toHaveLength(0);
		expect(result.error?.code).toBe('FILE_SIZE_LIMIT_EXCEEDED');
		expect(result.error?.title).toBe('Файл слишком большой');
		expect(result.error?.description).toContain('10 МБ');
	});

	it('accepts the exact attachment limit and rejects the next file without silently truncating', () => {
		const accepted = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => file(`${index}.txt`));
		expect(validateAndMergeFiles([], accepted).files).toHaveLength(MAX_ATTACHMENTS);
		const result = validateAndMergeFiles(accepted, [file('extra.txt')]);
		expect(result.files).toBe(accepted);
		expect(result.error?.code).toBe('ATTACHMENT_COUNT_LIMIT_EXCEEDED');
		expect(result.error?.description).toContain(String(MAX_ATTACHMENTS));
		expect(result.diagnostics).toEqual({ actualAttachments: MAX_ATTACHMENTS + 1, maximumAttachments: MAX_ATTACHMENTS });
	});

	it('counts existing and incoming attachments together', () => {
		const existing = Array.from({ length: 8 }, (_, index) => file(`existing-${index}.txt`));
		const incoming = Array.from({ length: 5 }, (_, index) => file(`incoming-${index}.txt`));
		const result = validateAndMergeFiles(existing, incoming);
		expect(result.files).toBe(existing);
		expect(result.error?.code).toBe('ATTACHMENT_COUNT_LIMIT_EXCEEDED');
		expect(result.diagnostics?.actualAttachments).toBe(13);
	});

	it('returns a dedicated total-size code', () => {
		const underSingleFileLimit = DEFAULT_ATTACHMENT_LIMITS.maxFileSize - 1;
		const result = validateAndMergeFiles([], [
			file('one.txt', underSingleFileLimit),
			file('two.txt', underSingleFileLimit),
			file('three.txt', underSingleFileLimit),
		]);
		expect(result.error?.code).toBe('ATTACHMENTS_TOTAL_SIZE_LIMIT_EXCEEDED');
		expect(result.error?.title).toBe('Превышен общий размер вложений');
	});
});
