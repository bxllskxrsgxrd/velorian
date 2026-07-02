import { useLayoutEffect, useRef } from 'react';

// Определяю типизированные пропсы
type useAutoResizeTextareaProps = {
	value: string;
	maxHeight?: number;
};

export function useAutoResizeTextarea({ value, maxHeight = 320 }: useAutoResizeTextareaProps) {
	// Создаю переменную, в которую передаю ссылку на атрибут в DOM с пустым значением
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Сигнатура для прослушивания ресайза textarea
	useLayoutEffect(() => {
		const textarea = textareaRef.current;

		if (!textarea) return;

		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
		textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
	}, [value, maxHeight]);

	return textareaRef;
}
