import React, { useRef } from 'react';
import { USER_MESSAGE_INLINE_CHAR_LIMIT } from '../../constants/limits';
import { PROMPT_TOOLS, promptMarker, stripPromptMarker } from '../../constants/promptTools';
import type { SearchMode } from '../../types/chat';
import { reportError } from '../../utils/reportError';
import { createPastedTextFile } from '../../utils/pastedTextFile';
import { SendIcon } from '../icons/AppIcons';
import { PromptActionsMenu } from '../PromptActionsMenu/PromptActionsMenu';
import { AutoResizeTextarea } from '../ui/AutoResizeTextarea/AutoResizeTextarea';
import { IconButton } from '../ui/IconButton/IconButton';
import './_promptBar.scss';
import { AttachmentPreview } from './AttachmentPreview';
import { usePromptStore } from '../../stores/promptStore';
import { useFilesStore } from '../../stores/filesStore';

type PromptBarProps = {
	onSendMessage: (prompt: string, files: File[], searchMode: SearchMode) => Promise<void>;
	onExport: (format: 'markdown' | 'json') => void;
	onStop: () => void;
	onOpenFile: (file: File) => void;
	isGenerating?: boolean;
	submissionKey?: string;
};

export function PromptBar({
	onSendMessage,
	onExport,
	onStop,
	onOpenFile,
	isGenerating = false,
	submissionKey = 'default',
}: PromptBarProps) {
	const files = useFilesStore((state) => state.files);
	const fileError = useFilesStore((state) => state.fileError);
	const onFilesSelect = useFilesStore((state) => state.addFiles);
	const onRemoveFile = useFilesStore((state) => state.removeFile);
	const onClearFiles = useFilesStore((state) => state.clearFiles);
	const isMultiline = usePromptStore((state) => state.isMultiline);
	const value = usePromptStore((state) => state.value);
	const searchMode = usePromptStore((state) => state.searchMode);
	const setIsMultiline = usePromptStore((state) => state.setMultiline);
	const setValue = usePromptStore((state) => state.setValue);
	const setSearchMode = usePromptStore((state) => state.setSearchMode);
	const resetPrompt = usePromptStore((state) => state.reset);
	const restorePrompt = usePromptStore((state) => state.restore);
	const submissionsRef = useRef(new Set<string>());
	const promptValue = stripPromptMarker(value, searchMode);
	const isSendDisabled = isGenerating || (!promptValue.trim() && files.length === 0);
	const promptBarClassName = [
		'prompt-bar',
		isMultiline && 'prompt-bar--multiline',
	]
		.filter(Boolean)
		.join(' ');

	function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
		const nextValue = event.currentTarget.value;
		if (searchMode !== 'none' && !nextValue.startsWith(PROMPT_TOOLS[searchMode].marker)) {
			const currentPrompt = stripPromptMarker(value, searchMode);
			const promptPosition = currentPrompt ? nextValue.lastIndexOf(currentPrompt) : -1;
			setSearchMode('none');
			setValue(promptPosition >= 0 ? nextValue.slice(promptPosition) : currentPrompt);
			return;
		}
		setValue(nextValue);
	}

	function handleSearchModeChange(mode: SearchMode) {
		setValue((current) => `${promptMarker(mode)}${stripPromptMarker(current, searchMode)}`);
		setSearchMode(mode);
	}

	function handleEnterDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || isGenerating) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
		const pastedText = event.clipboardData.getData('text/plain');
		if (pastedText.length <= USER_MESSAGE_INLINE_CHAR_LIMIT) return;
		event.preventDefault();
		onFilesSelect([createPastedTextFile(pastedText)]);
	}

	async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSendDisabled || submissionsRef.current.has(submissionKey)) return;
		submissionsRef.current.add(submissionKey);
		const prompt = stripPromptMarker(value, searchMode).trim();
		const submittedFiles = [...files];
		const submittedSearchMode = searchMode;
		setValue('');
		setSearchMode('none');
		onClearFiles();
		resetPrompt();
		try {
			await onSendMessage(prompt, submittedFiles, submittedSearchMode);
		} catch (error) {
			reportError('Не удалось отправить сообщение', error);
			restorePrompt(`${promptMarker(submittedSearchMode)}${prompt}`, submittedSearchMode);
			onFilesSelect(submittedFiles);
		} finally {
			submissionsRef.current.delete(submissionKey);
		}
	}

	function handlePromptBarClick(event: React.MouseEvent<HTMLFormElement>) {
		if (!(event.target instanceof Element)) return;
		if (event.target.closest('textarea, .prompt-bar__actions, .prompt-bar__send, .prompt-bar__attachments, .prompt-bar__error')) return;
		const textarea = event.currentTarget.querySelector<HTMLTextAreaElement>('textarea[aria-label="Введите запрос"]');
		if (!textarea?.disabled) textarea.focus({ preventScroll: true });
	}

	return (
		<form className={promptBarClassName} onClick={handlePromptBarClick} onSubmit={handleSubmit}>
			{files.length > 0 && (
				<div className="prompt-bar__attachments">
					{files.map((file, index) => (
						<AttachmentPreview
							key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
							file={file}
							onRemove={() => onRemoveFile(index)}
							onOpen={onOpenFile}
						/>
					))}
				</div>
			)}
			{fileError && (
				<div className="prompt-bar__error" role="alert">
					<strong className="prompt-bar__error-title">{fileError.title}</strong>
					<span className="prompt-bar__error-description">{fileError.description}</span>
				</div>
			)}

			<div className="prompt-bar__input-container">
				<div className="prompt-bar__actions">
					<PromptActionsMenu
						onFilesSelect={onFilesSelect}
						onExport={onExport}
						searchMode={searchMode}
						onSearchModeChange={handleSearchModeChange}
					/>
				</div>
				<AutoResizeTextarea
					value={value}
					onChange={handleChange}
					onMultilineChange={setIsMultiline}
					onKeyDown={handleEnterDown}
					onPaste={handlePaste}
				/>
				<div className="prompt-bar__send">
					{isGenerating ? (
						<IconButton onClick={onStop} aria-label="Остановить генерацию">
							<span className="prompt-bar__stop" />
						</IconButton>
					) : (
						<IconButton disabled={isSendDisabled} type="submit" aria-label="Отправить сообщение">
							<SendIcon />
						</IconButton>
					)}
				</div>
			</div>
		</form>
	);
}
