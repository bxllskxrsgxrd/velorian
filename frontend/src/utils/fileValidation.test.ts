import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE, validateAndMergeFiles } from './fileValidation';

function file(name: string, size = 4) {
	return new File([new Uint8Array(size)], name);
}

describe('validateAndMergeFiles', () => {
	it('accepts supported files', () => {
		const result = validateAndMergeFiles([], [file('notes.txt'), file('photo.jpg')]);
		expect(result.error).toBe('');
		expect(result.files).toHaveLength(2);
	});

	it('rejects unsupported extensions without changing current files', () => {
		const current = [file('notes.txt')];
		const result = validateAndMergeFiles(current, [file('archive.exe')]);
		expect(result.files).toBe(current);
		expect(result.error).toContain('не поддерживается');
	});

	it('rejects a file over the size limit', () => {
		const result = validateAndMergeFiles([], [file('huge.pdf', MAX_FILE_SIZE + 1)]);
		expect(result.files).toHaveLength(0);
		expect(result.error).toContain('10 МБ');
	});
});
