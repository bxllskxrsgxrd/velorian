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
	const targetHeightRef = useRef<number | null>(null);
	const previousValueRef = useRef<string>(value);

	// Сигнатура для прослушивания ресайза textarea
	useLayoutEffect(() => {
		const textarea = textareaRef.current;

		if (!textarea) return;

		// Получаю стили, чтобы корректно вычислять высоту textarea
		const styles = getComputedStyle(textarea);

		// Получаю высоту строки и паддинги, чтобы корректно вычислять высоту textarea
		const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
		const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
		const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;

		// Вычисляю высоту одной строки с учетом паддингов
		const oneLineHeight = lineHeight + paddingTop + paddingBottom;

		// Получаю текущую высоту textarea, чтобы избежать "скачков" при изменении размера
		const currentHeight = Math.max(textarea.getBoundingClientRect().height, oneLineHeight);

		const previousValue = previousValueRef.current;

		// Проверяю, нужно ли уменьшать высоту textarea, если текущее значение меньше предыдущего
		const shouldMeasureShrink = value.length <= previousValue.length;

		let scrollHeight = textarea.scrollHeight;

		if (shouldMeasureShrink) {
			// Устанавливаю высоту textarea в auto, чтобы корректно вычислять scrollHeight
			textarea.style.transition = 'none';
			textarea.style.height = '0px';

			scrollHeight = textarea.scrollHeight;

			// Возвращаю высоту textarea в исходное состояние, чтобы избежать "скачков" при изменении размера
			textarea.style.height = `${currentHeight}px`;

			// Принудительно вызываю reflow, чтобы браузер применил изменения стилей
			void textarea.offsetHeight;

			textarea.style.transition = '';
		}

		const nextHeight = Math.min(Math.max(scrollHeight, oneLineHeight), maxHeight);

		const hasOverflow = scrollHeight > maxHeight;
		const hasMultipleLines = scrollHeight > oneLineHeight + 1;

		const previousTargetHeight = targetHeightRef.current;

		const heightChanged = previousTargetHeight === null || Math.abs(previousTargetHeight - nextHeight) > 0.5;

		textarea.style.maxHeight = `${maxHeight}px`;
		textarea.style.overflowY = hasOverflow ? 'auto' : 'hidden';

		if (heightChanged) {
			textarea.style.transition = 'none';
			textarea.style.height = `${currentHeight}px`;

			// Принудительно вызываю reflow, чтобы браузер применил изменения стилей
			void textarea.offsetHeight;

			textarea.style.transition = '';
			textarea.style.height = `${nextHeight}px`;

			targetHeightRef.current = nextHeight;
		}
		setIsMultiline((previousIsMultiline) => {
			if (value.length === 0) {
				return false;
			}

			return previousIsMultiline || hasMultipleLines;
		});

		previousValueRef.current = value;
	}, [value, maxHeight]);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;

		if (!textarea) return;

		const updateScrollMask = () => {
			const { scrollTop, scrollHeight, clientHeight } = textarea;

			const threshold = 1;

			const hasOverflow = scrollHeight > clientHeight + threshold;
			const canScrollUp = scrollTop > threshold;
			const canScrollDown = scrollTop + clientHeight < scrollHeight - threshold;

			textarea.style.setProperty('--top-fade', hasOverflow && canScrollUp ? 'transparent' : 'var(--color-black)');

			textarea.style.setProperty('--bottom-fade', hasOverflow && canScrollDown ? 'transparent' : 'var(--color-black)');
		};

		const resizeObserver = new ResizeObserver(updateScrollMask);

		resizeObserver.observe(textarea);
		textarea.addEventListener('scroll', updateScrollMask);

		const frameId = requestAnimationFrame(updateScrollMask);

		return () => {
			cancelAnimationFrame(frameId);
			resizeObserver.disconnect();
			textarea.removeEventListener('scroll', updateScrollMask);
		};
	}, [value]);

	return { textareaRef, isMultiline };
}
