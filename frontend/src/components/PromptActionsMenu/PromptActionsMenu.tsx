import { useState } from 'react';
import { PlusIcon } from '../icons/PlusIcon';
import { IconButton } from '../ui/IconButton/IconButton';

import './_promptActionsMenu.scss';

export function PromptActionsMenu() {
	const [open, setOpen] = useState(false);

	return (
		<div className="prompt-actions">
			<IconButton onClick={() => setOpen((v) => !v)}>
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
