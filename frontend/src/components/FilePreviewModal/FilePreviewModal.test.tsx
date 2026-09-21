import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getFileCodeLanguage } from '../../utils/codeLanguage';
import { FilePreviewModal } from './FilePreviewModal';

const imageFile = {
	name: 'preview.png',
	size: 128,
	type: 'image/png',
	url: 'blob:preview',
};

describe('FilePreviewModal', () => {
	it('closes only from the close button or Escape', () => {
		const onClose = vi.fn();
		const { container } = render(<FilePreviewModal file={imageFile} onClose={onClose} />);

		fireEvent.click(container.querySelector('.file-preview')!);
		fireEvent.click(container.querySelector('.file-preview__image-header')!);
		fireEvent.click(container.querySelector('.file-preview__image-container')!);
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Закрыть превью' }));
		expect(onClose).toHaveBeenCalledOnce();

		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it('detects code language by extension and then MIME type', () => {
		expect(getFileCodeLanguage('component.tsx', 'text/plain')).toBe('tsx');
		expect(getFileCodeLanguage('source', 'application/json; charset=utf-8')).toBe('json');
		expect(getFileCodeLanguage('notes.txt', 'text/plain')).toBeNull();
	});
});
