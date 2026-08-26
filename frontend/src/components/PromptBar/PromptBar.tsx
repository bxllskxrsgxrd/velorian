import React, { useEffect, useRef, useState } from 'react';
import { USER_MESSAGE_INLINE_CHAR_LIMIT } from '../../constants/limits';
import { PROMPT_TOOLS, promptMarker, stripPromptMarker } from '../../constants/promptTools';
import type { ChatMessageError, SearchMode } from '../../types/chat';
import { reportError } from '../../utils/reportError';
import { createPastedTextFile } from '../../utils/pastedTextFile';
import { MicrophoneIcon } from '../icons/MicrophoneIcon';
import { SendIcon } from '../icons/SendIcon';
import { PromptActionsMenu } from '../PromptActionsMenu/PromptActionsMenu';
import { AutoResizeTextarea } from '../ui/AutoResizeTextarea/AutoResizeTextarea';
import { IconButton } from '../ui/IconButton/IconButton';
import './_promptBar.scss';
import { AttachmentPreview } from './AttachmentPreview';

type SpeechRecognitionEventLike = Event & {
	results: ArrayLike<{ 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	start: () => void;
	stop: () => void;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type PromptBarProps = {
	files: File[];
	fileError?: ChatMessageError | null;
	isGenerating: boolean;
	onSendMessage: (prompt: string, files: File[], searchMode: SearchMode) => Promise<void>;
	onStop: () => void;
	onRemoveFile: (index: number) => void;
	onOpenFile: (file: File) => void;
	onFilesSelect: (files: File[]) => void;
	onClearFiles: () => void;
};

export function PromptBar({
	files,
	fileError,
	isGenerating,
	onSendMessage,
	onStop,
	onRemoveFile,
	onOpenFile,
	onFilesSelect,
	onClearFiles,
}: PromptBarProps) {
	const [isMultiline, setIsMultiline] = useState(false);
	const [value, setValue] = useState('');
	const [searchMode, setSearchMode] = useState<SearchMode>('none');
	const [isListening, setIsListening] = useState(false);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const speechWindow = window as typeof window & {
		SpeechRecognition?: SpeechRecognitionConstructor;
		webkitSpeechRecognition?: SpeechRecognitionConstructor;
	};
	const voiceInputAvailable = Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition);
	const promptValue = stripPromptMarker(value, searchMode);
	const isSendDisabled = isGenerating || (!promptValue.trim() && files.length === 0);
	const promptBarClassName = [
		'prompt-bar',
		isMultiline && 'prompt-bar--multiline',
		voiceInputAvailable && 'prompt-bar--with-voice',
	]
		.filter(Boolean)
		.join(' ');

	useEffect(
		() => () => {
			const recognition = recognitionRef.current;
			if (!recognition) return;
			recognition.onresult = null;
			recognition.onend = null;
			recognition.onerror = null;
			recognition.stop();
			recognitionRef.current = null;
		},
		[],
	);

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
		if (isSendDisabled) return;
		const prompt = stripPromptMarker(value, searchMode).trim();
		const submittedFiles = [...files];
		const submittedSearchMode = searchMode;
		setValue('');
		setSearchMode('none');
		onClearFiles();
		try {
			await onSendMessage(prompt, submittedFiles, submittedSearchMode);
		} catch (error) {
			reportError('Не удалось отправить сообщение', error);
			setSearchMode(submittedSearchMode);
			setValue(`${promptMarker(submittedSearchMode)}${prompt}`);
			onFilesSelect(submittedFiles);
		}
	}

	function toggleVoiceInput() {
		if (recognitionRef.current) {
			recognitionRef.current.stop();
			return;
		}
		const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
		if (!Recognition) return;
		const recognition = new Recognition();
		recognition.lang = 'ru-RU';
		recognition.interimResults = false;
		recognition.continuous = false;
		recognition.onresult = (event) => {
			const transcript = event.results[0]?.[0]?.transcript ?? '';
			setValue((current) => `${current}${current && transcript && !current.endsWith(' ') ? ' ' : ''}${transcript}`);
		};
		recognition.onend = () => {
			recognitionRef.current = null;
			setIsListening(false);
		};
		recognition.onerror = recognition.onend;
		recognitionRef.current = recognition;
		setIsListening(true);
		recognition.start();
	}

	return (
		<form className={promptBarClassName} onSubmit={handleSubmit}>
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
				{voiceInputAvailable && (
					<IconButton
						className={isListening ? 'prompt-bar__voice prompt-bar__voice--active' : 'prompt-bar__voice'}
						onClick={toggleVoiceInput}
						aria-label={isListening ? 'Остановить запись' : 'Голосовой ввод'}
					>
						<MicrophoneIcon />
					</IconButton>
				)}

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
