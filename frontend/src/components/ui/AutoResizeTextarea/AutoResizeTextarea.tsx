import { useLayoutEffect, useRef } from "react";
import './_autoResizeTextarea.scss'

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
  placeholder = "Что Ищем?",
  maxHeight = 320,
}: AutoResizeTextareaProps) {
  // Создаю переменную, в которую передаю ссылку на атрибут в DOM с пустым значением
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Сигнатура для прослушивания ресайза textarea
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);
  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      className="resizeTextarea"
    ></textarea>
  );
}
