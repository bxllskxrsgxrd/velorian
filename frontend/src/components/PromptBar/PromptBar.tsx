import React, { type SyntheticEvent } from 'react';
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
	return (
		<form className="prompt-bar" onSubmit={onSubmit}>
			{files.length > 0 && (
				<div className="prompt-bar__attachments">
					{files.map((file, index) => (
						<AttachmentPreview file={file} onRemove={() => onRemoveFile(index)} />
					))}
				</div>
			)}
			<div className="prompt-bar__input-container">
				<PromptActionsMenu />
				<AutoResizeTextarea value={value} onChange={onChange} />

				<IconButton type="submit" aria-label="Отправить сообщение">
					<SendIcon />
				</IconButton>
			</div>
		</form>
	);
}
