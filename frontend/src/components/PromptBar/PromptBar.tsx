import React, { useState, type SyntheticEvent } from 'react';
import { SendIcon } from '../icons/SendIcon';
import { PromptActionsMenu } from '../PromptActionsMenu/PromptActionsMenu';
import { AutoResizeTextarea } from '../ui/AutoResizeTextarea/AutoResizeTextarea';
import { IconButton } from '../ui/IconButton/IconButton';
import './_promptBar.scss';
import { AttachmentPreview } from './AttachmentPreview';

type PromptBarProps = {
	value: string;
	files: File[];
	onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	onSubmit: (e: SyntheticEvent<HTMLFormElement>) => void;
	onRemoveFile: (index: number) => void;
};

export function PromptBar({ value, files, onChange, onSubmit, onRemoveFile }: PromptBarProps) {
	const [isMultiline, setIsMultiline] = useState(false);

	function handleEnterDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key !== 'Enter') return;

		if (e.shiftKey) return;

		e.preventDefault();

		e.currentTarget.form?.requestSubmit();
	}

	return (
		<form className={isMultiline ? 'prompt-bar prompt-bar-multiline' : 'prompt-bar'} onSubmit={onSubmit}>
			{files.length > 0 && (
				<div className="prompt-bar__attachments">
					{files.map((file, index) => (
						<AttachmentPreview
							key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
							file={file}
							onRemove={() => onRemoveFile(index)}
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
					onChange={onChange}
					onMultilineChange={setIsMultiline}
					onKeyDown={handleEnterDown}
				/>

				<div className="prompt-bar__send">
					<IconButton type="submit" aria-label="Отправить сообщение">
						<SendIcon />
					</IconButton>
				</div>
			</div>
		</form>
	);
}
