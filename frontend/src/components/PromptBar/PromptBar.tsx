import React from 'react';
import { SendIconButton } from '../IconsButton/SendIconButton';
import { PromptActionsMenu } from '../PromptActionsMenu/PromptActionsMenu';
import { AutoResizeTextarea } from '../ui/AutoResizeTextarea/AutoResizeTextarea';
import { IconButton } from '../ui/IconButton/IconButton';
import './_promptBar.scss';

type PromptBarProps = {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	onSubmit: () => void;
};

export function PromptBar({ value, onChange, onSubmit }: PromptBarProps) {
	return (
		<div className="prompt-bar">
			<PromptActionsMenu />
			<AutoResizeTextarea value={value} onChange={onChange} />

			<IconButton onClick={onSubmit}>
				<SendIconButton />
			</IconButton>
		</div>
	);
}
