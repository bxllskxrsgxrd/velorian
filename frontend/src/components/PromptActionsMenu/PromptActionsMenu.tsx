import { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '../icons/PlusIcon';
import { IconButton } from '../ui/IconButton/IconButton';

import './_promptActionsMenu.scss';
import { AttachFilesAction } from './PromptActionsMenuButtons/AttachFilesAction';
import { PromptActionButton } from './PromptActionsMenuButtons/PromptActionButton';

type PromptActionsMenuProps = {
	onFilesSelect: (files: File[]) => void;
	webSearch: boolean;
	onWebSearchChange: (enabled: boolean) => void;
};

export function PromptActionsMenu({ onFilesSelect, webSearch, onWebSearchChange }: PromptActionsMenuProps) {
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

	function handleWebSearchClick() {
		onWebSearchChange(!webSearch);
		closeMenu();
	}

	useEffect(() => {
		if (!open) return;

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
	}, [open]);

	return (
		<div ref={rootRef} className="prompt-actions">
			<IconButton
				ref={buttonRef}
				onClick={() => setOpen((v) => !v)}
				aria-label="Открыть меню действий"
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<PlusIcon />
			</IconButton>

			{open && (
				<div className="prompt-actions__menu" role="menu">
					<AttachFilesAction onFilesSelect={handleFilesSelect} />
					<PromptActionButton
						role="menuitemcheckbox"
						aria-checked={webSearch}
						className={webSearch ? 'prompt-action-btn--active' : ''}
						onClick={handleWebSearchClick}
					>
						{webSearch ? 'Отключить поиск в сети' : 'Поиск в сети'}
					</PromptActionButton>
				</div>
			)}
		</div>
	);
}
