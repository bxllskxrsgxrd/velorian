import React, { useLayoutEffect } from 'react';
import { useTextareaMultiline } from '../../../hooks/useTextareaMultiline';
import './_autoResizeTextarea.scss';

// Определяю типизированные пропсы
type AutoResizeTextareaProps = {
	value: string;
	// Функция с событием "ChangeEvent" изменения HTML атрибута textarea, функция ничего не возвращает
	onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	placeholder?: string;
	onMultilineChange?: (isMultiline: boolean) => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};

export function AutoResizeTextarea({
	value,

	onChange,
	placeholder = 'Введите запрос для Velorian',
	onMultilineChange,
	onKeyDown,
	onPaste,
}: AutoResizeTextareaProps) {
	// Создаю объект, в который передаю ссылки
	const { textareaRef, isMultiline } = useTextareaMultiline({
		value,
	});

	useLayoutEffect(() => {
		onMultilineChange?.(isMultiline);
	}, [isMultiline, onMultilineChange]);

	return (
		<textarea
			aria-label="Введите запрос"
			ref={textareaRef}
			rows={1}
			value={value}
			placeholder={placeholder}
			onChange={onChange}
			onKeyDown={onKeyDown}
			onPaste={onPaste}
			className="resizeTextarea"
		></textarea>
	);
}
