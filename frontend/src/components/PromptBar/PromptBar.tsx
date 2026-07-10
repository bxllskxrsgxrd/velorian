import React, { useState } from 'react';
import { SendIcon } from '../icons/SendIcon';
import { SubmitLoadingIcon } from '../icons/SubmitLoadingIcon/SubmitLoadingIcon';
import { PromptActionsMenu } from '../PromptActionsMenu/PromptActionsMenu';
import { AutoResizeTextarea } from '../ui/AutoResizeTextarea/AutoResizeTextarea';
import { IconButton } from '../ui/IconButton/IconButton';
import './_promptBar.scss';
import { AttachmentPreview } from './AttachmentPreview';

type PromptBarProps = {
	files: File[];
	onSendMessage: (prompt: string) => Promise<void>;
	onRemoveFile: (index: number) => void;
	onOpenFile: (file: File) => void;
};

export function PromptBar({ files, onSendMessage, onRemoveFile, onOpenFile }: PromptBarProps) {
	const [isMultiline, setIsMultiline] = useState(false);
	const [value, setValue] = useState('');
	const [isSubmit, setIsSubmit] = useState(false);

	const isSendDisabled = isSubmit || (!value.trim() && files.length === 0);

	// ОТПРАВЛЕНИЕ ЗАПРОСА \\
	function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setValue(e.currentTarget.value);
	}

	function handleEnterDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key !== 'Enter') return;
		if (e.shiftKey) return;
		if (isSubmit) return;

		e.preventDefault();

		e.currentTarget.form?.requestSubmit();
	}

	async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
		e.preventDefault();
		e.stopPropagation();
		if (isSubmit) return;

		const prompt = value.trim();

		if (!prompt && files.length === 0) return;

		try {
			setIsSubmit(true);

			await onSendMessage(prompt);

			setValue('');
		} finally {
			setIsSubmit(false);
		}
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
			<div className="prompt-bar__input-container">
				<div className="prompt-bar__actions">
					<PromptActionsMenu />
				</div>

				<AutoResizeTextarea
					value={value}
					onChange={handleChange}
					onMultilineChange={setIsMultiline}
					onKeyDown={handleEnterDown}
				/>

				<div className="prompt-bar__send">
					<IconButton disabled={isSendDisabled} type="submit" aria-label="Отправить сообщение">
						{isSubmit ? <SubmitLoadingIcon /> : <SendIcon />}
					</IconButton>
				</div>
			</div>
		</form>
	);
}
