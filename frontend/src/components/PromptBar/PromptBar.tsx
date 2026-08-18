import React, { useEffect, useRef, useState } from 'react';
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
	fileError?: string;
	isGenerating: boolean;
	onSendMessage: (prompt: string, files: File[], webSearch: boolean) => Promise<void>;
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
	const [webSearch, setWebSearch] = useState(false);
	const [isListening, setIsListening] = useState(false);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const speechWindow = window as typeof window & {
		SpeechRecognition?: SpeechRecognitionConstructor;
		webkitSpeechRecognition?: SpeechRecognitionConstructor;
	};
	const voiceInputAvailable = Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition);
	const isSendDisabled = isGenerating || (!value.trim() && files.length === 0);

	useEffect(() => () => {
		const recognition = recognitionRef.current;
		if (!recognition) return;
		recognition.onresult = null;
		recognition.onend = null;
		recognition.onerror = null;
		recognition.stop();
		recognitionRef.current = null;
	}, []);

	function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
		setValue(event.currentTarget.value);
	}

	function handleEnterDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || isGenerating) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (isSendDisabled) return;
		const prompt = value.trim();
		const submittedFiles = [...files];
		setValue('');
		onClearFiles();
		try {
			await onSendMessage(prompt, submittedFiles, webSearch);
		} catch {
			setValue(prompt);
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
			setValue((current) => `${current}${current && transcript ? ' ' : ''}${transcript}`);
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
		<form className={isMultiline ? 'prompt-bar prompt-bar--multiline' : 'prompt-bar'} onSubmit={handleSubmit}>
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
			{fileError && <div className="prompt-bar__error" role="alert">{fileError}</div>}
			<div className="prompt-bar__options">
				<label className="prompt-bar__search-toggle">
					<input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} />
					<span>Веб-поиск</span>
				</label>
				{voiceInputAvailable && (
					<button className={isListening ? 'prompt-bar__voice prompt-bar__voice--active' : 'prompt-bar__voice'} type="button" onClick={toggleVoiceInput}>
						{isListening ? 'Остановить запись' : 'Голосовой ввод'}
					</button>
				)}
			</div>
			<div className="prompt-bar__input-container">
				<div className="prompt-bar__actions"><PromptActionsMenu onFilesSelect={onFilesSelect} /></div>
				<AutoResizeTextarea value={value} onChange={handleChange} onMultilineChange={setIsMultiline} onKeyDown={handleEnterDown} />
				<div className="prompt-bar__send">
					{isGenerating ? (
						<IconButton type="button" onClick={onStop} aria-label="Остановить генерацию"><span className="prompt-bar__stop" /></IconButton>
					) : (
						<IconButton disabled={isSendDisabled} type="submit" aria-label="Отправить сообщение"><SendIcon /></IconButton>
					)}
				</div>
			</div>
		</form>
	);
}
