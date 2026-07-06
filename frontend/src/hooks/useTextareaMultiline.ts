import { useLayoutEffect, useRef, useState } from 'react';

// Определяю типизированные пропсы
type useTextareaMultilineProps = {
	value: string;
};

export function useTextareaMultiline({ value }: useTextareaMultilineProps) {
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

		const nextIsMultiline = textarea.scrollHeight > oneLineHeight + 1;

		setIsMultiline((prev) => {
			if (prev === nextIsMultiline) return prev;

			return nextIsMultiline;
		});
	}, [value]);

	return { textareaRef, isMultiline };
}
