import { useAutoResizeTextarea } from '../../../hooks/useAutoResizeTextarea';
import './_autoResizeTextarea.scss';

// Определяю типизированные пропсы
type AutoResizeTextareaProps = {
	value: string;
	// Функция с событием "ChangeEvent" изменения HTML атрибута textarea, функция ничего не возвращает
	onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	placeholder?: string;
	maxHeight?: number;
};

export function AutoResizeTextarea({
	value,
	onChange,
	placeholder = 'Что Ищем?',
	maxHeight = 320,
}: AutoResizeTextareaProps) {
	// Создаю переменную, в которую передаю ссылку на атрибут в DOM
	const textareaRef = useAutoResizeTextarea({
		value,
		maxHeight,
	});

	return (
		<textarea
			aria-label="Введите запрос"
			ref={textareaRef}
			rows={1}
			value={value}
			placeholder={placeholder}
			onChange={onChange}
			className="resizeTextarea"
		></textarea>
	);
}
