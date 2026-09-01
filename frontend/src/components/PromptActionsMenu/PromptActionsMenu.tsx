import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createStore, useStore } from 'zustand';
import { PlusIcon } from '../icons/AppIcons';
import { IconButton } from '../ui/IconButton/IconButton';

import './_promptActionsMenu.scss';
import { AttachFilesAction } from './PromptActionsMenuButtons/AttachFilesAction';
import { PromptActionButton } from './PromptActionsMenuButtons/PromptActionButton';
import { PROMPT_TOOLS } from '../../constants/promptTools';
import type { SearchMode } from '../../types/chat';

type PromptActionsMenuProps = {
	onFilesSelect: (files: File[]) => void;
	searchMode: SearchMode;
	onSearchModeChange: (mode: SearchMode) => void;
};

function createPromptActionsUiStore() {
	return createStore<{ open: boolean; setOpen: (value: boolean | ((current: boolean) => boolean)) => void }>((set) => ({
		open: false,
		setOpen: (value) => set((state) => ({ open: typeof value === 'function' ? value(state.open) : value })),
	}));
}

export function PromptActionsMenu({ onFilesSelect, searchMode, onSearchModeChange }: PromptActionsMenuProps) {
	const store = useMemo(() => createPromptActionsUiStore(), []);
	const open = useStore(store, (state) => state.open);
	const setOpen = useStore(store, (state) => state.setOpen);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const closeMenu = useCallback(() => {
		setOpen(false);
		buttonRef.current?.blur();
	}, [setOpen]);

	function handleFilesSelect(files: File[]) {
		onFilesSelect(files);
		closeMenu();
	}

	function handleSearchModeClick(mode: Exclude<SearchMode, 'none'>) {
		onSearchModeChange(searchMode === mode ? 'none' : mode);
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
	}, [closeMenu, open]);

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
					{(Object.keys(PROMPT_TOOLS) as Array<Exclude<SearchMode, 'none'>>).map((mode) => {
						const tool = PROMPT_TOOLS[mode];
						const active = searchMode === mode;
						return <PromptActionButton key={mode} role="menuitemradio" aria-checked={active} className={active ? 'prompt-action-btn--active' : ''} onClick={() => handleSearchModeClick(mode)}>{active ? tool.activeLabel : tool.label}</PromptActionButton>;
					})}
				</div>
			)}
		</div>
	);
}
