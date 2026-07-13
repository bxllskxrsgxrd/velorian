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

		textarea.style.height = 'auto';

		const styles = getComputedStyle(textarea);

		const lineHeight = parseFloat(styles.lineHeight);
		const paddingTop = parseFloat(styles.paddingTop);
		const paddingBottom = parseFloat(styles.paddingBottom);

		const oneLineHeight = lineHeight + paddingTop + paddingBottom;
		const contentHeight = textarea.scrollHeight;

		const nextHeight = Math.min(contentHeight, maxHeight);
		const nextIsMultiline = contentHeight > oneLineHeight + 1;
		const hasOverflow = contentHeight > maxHeight;

		textarea.style.height = `${nextHeight}px`;
		textarea.style.maxHeight = `${maxHeight}px`;
		textarea.style.overflowY = hasOverflow ? 'auto' : 'hidden';

		setIsMultiline((prev) => {
			if (prev === nextIsMultiline) return prev;

			return nextIsMultiline;
		});
	}, [value, maxHeight]);

	return { textareaRef, isMultiline };
}
