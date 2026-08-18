import React, { useRef } from 'react';
import { PromptActionButton } from './PromptActionButton';

type AttachFilesActionProps = {
	onFilesSelect: (files: File[]) => void;
};

export function AttachFilesAction({ onFilesSelect }: AttachFilesActionProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	function handleOpenFilePicker() {
		inputRef.current?.click();
	}

	function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
		const selectedFiles = Array.from(e.currentTarget.files ?? []);

		if (selectedFiles.length > 0) {
			onFilesSelect(selectedFiles);
		}

		e.currentTarget.value = '';
	}

	return (
		<>
			<PromptActionButton role="menuitem" onClick={handleOpenFilePicker}>
				Прикрепить фото и файлы
			</PromptActionButton>

			<input type="file" ref={inputRef} onChange={handleFilesChange} multiple hidden accept='image/*,.pdf,.doc,.txt,.html,.css,.js' />
		</>
	);
}
