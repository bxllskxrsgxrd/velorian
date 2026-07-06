import React, { useEffect } from 'react';
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
};

export function AutoResizeTextarea({
	value,
	onChange,
	placeholder = 'Что Ищем?',
	onMultilineChange,
	onKeyDown
}: AutoResizeTextareaProps) {
	// Создаю объект, в который передаю ссылки
	const { textareaRef, isMultiline } = useTextareaMultiline({
		value,
	});

	useEffect(() => {
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
			className="resizeTextarea"
		></textarea>
	);
}
