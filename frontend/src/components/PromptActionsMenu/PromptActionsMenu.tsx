import React, { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '../icons/PlusIcon';
import { IconButton } from '../ui/IconButton/IconButton';

import './_promptActionsMenu.scss';

export function PromptActionsMenu() {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	function closeMenu() {
		setOpen(false);
		buttonRef.current?.blur();
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
					<button className="prompt-actions__menu-button" type="button">
						Прикрепить фото и файлы
					</button>
					<button className="prompt-actions__menu-button" type="button">
						Создать изображение
					</button>
					<button className="prompt-actions__menu-button" type="button">
						Поиск в сети
					</button>
					<button className="prompt-actions__menu-button" type="button">
						Глубокое исследование
					</button>
				</div>
			)}
		</div>
	);
}
