export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Б';

	const k = 1024;
	// Список доступных единиц измерения
	const sizes = ['Б', 'КБ', 'МБ'];

	// Находим индекс нужной единицы измерения (0 - Байты, 1 - КБ и т.д.)
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	// Ограничиваем индекс, чтобы не выйти за пределы массива размеров
	const safeIndex = Math.min(i, sizes.length - 1);

	// Вычисляем итоговое число
	const size = bytes / Math.pow(k, safeIndex);

	// Если это байты, выводим целое число
	// Если КБ/МБ — округляем до 1 знака после запятой (например: 14.6 МБ)
	return `${safeIndex === 0 ? size : size.toFixed(1)} ${sizes[safeIndex]}`;
}
