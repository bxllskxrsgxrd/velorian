import { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '../icons/PlusIcon';
import { IconButton } from '../ui/IconButton/IconButton';

import './_promptActionsMenu.scss';
import { AttachFilesAction } from './PromptActionsMenuButtons/AttachFilesAction';
import { PromptActionButton } from './PromptActionsMenuButtons/PromptActionButton';

type PromptActionsMenuProps = {
	onFilesSelect: (files: File[]) => void;
};

export function PromptActionsMenu({ onFilesSelect }: PromptActionsMenuProps) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	function closeMenu() {
		setOpen(false);
		buttonRef.current?.blur();
	}

	function handleFilesSelect(files: File[]) {
		onFilesSelect(files);
		closeMenu();
	}

	useEffect(() => {
		function handleClick(e: PointerEvent) {
			if (!rootRef.current) return;

			if (!rootRef.current.contains(e.target as Node)) closeMenu();
		}

		function handleEsc(e: KeyboardEvent) {
			if (e.key === 'Escape') closeMenu();
		}

		window.addEventListener('keydown', handleEsc);
		document.addEventListener('pointerdown', handleClick);

		return () => {
			window.removeEventListener('keydown', handleEsc);
			document.removeEventListener('pointerdown', handleClick);
		};
	}, []);

	return (
		<div ref={rootRef} className="prompt-actions">
			<IconButton ref={buttonRef} onClick={() => setOpen((v) => !v)}>
				<PlusIcon />
			</IconButton>

			{open && (
				<div className="prompt-actions__menu">
					<AttachFilesAction onFilesSelect={handleFilesSelect} />
					{/* нижний компонент заменить на аналогичный добавлению файлов*/}
					<PromptActionButton>Поиск в базе данных</PromptActionButton>
				</div>
			)}
		</div>
	);
}
