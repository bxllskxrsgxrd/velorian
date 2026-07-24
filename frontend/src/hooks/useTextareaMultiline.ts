import { useLayoutEffect, useRef, useState } from 'react';

// Определяю типизированные пропсы
type useTextareaMultilineProps = {
	value: string;
	maxHeight?: number;
};

export function useTextareaMultiline({ value, maxHeight = 320 }: useTextareaMultilineProps) {
	const [isMultiline, setIsMultiline] = useState(false);
	// Создаю переменную, в которую передаю ссылку на атрибут в DOM с пустым значением
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Сигнатура для прослушивания ресайза textarea
	useLayoutEffect(() => {
		const textarea = textareaRef.current;

		if (!textarea) return;

		const styles = getComputedStyle(textarea);

		const lineHeight = Number.parseFloat(styles.lineHeight);
		const paddingTop = Number.parseFloat(styles.paddingTop);
		const paddingBottom = Number.parseFloat(styles.paddingBottom);

		textarea.style.height = '0px';

		const scrollHeight = textarea.scrollHeight;
		const oneLineHeight = lineHeight + paddingTop + paddingBottom;

		const nextHeight = Math.min(scrollHeight, maxHeight);
		const hasOverflow = scrollHeight > maxHeight;
		const hasMultipleLines = scrollHeight > oneLineHeight + 1;


		textarea.style.height = `${nextHeight}px`;
		textarea.style.maxHeight = `${maxHeight}px`;
		textarea.style.overflowY = hasOverflow ? 'auto' : 'hidden';

		setIsMultiline((prev) => {
			if(!value) return false;

			return prev || hasMultipleLines;
		});
	}, [value, maxHeight]);

	return { textareaRef, isMultiline };
}
