import { StarIcon } from '../../icons/AppIcons';
import './_rating.scss';

type RatingProps = {
	value?: number | null;
	readonly?: boolean;
	onChange?: (rating: number | null) => void;
	label?: string;
	className?: string;
};

export function Rating({ value, readonly = false, onChange, label = 'Рейтинг', className = '' }: RatingProps) {
	const current = value ?? 0;
	return (
		<div className={`rating ${readonly ? 'rating--readonly' : ''} ${className}`.trim()} role={readonly ? 'img' : 'group'} aria-label={readonly ? `${label}: ${value ?? 'без оценки'} из 5` : label}>
			{[1, 2, 3, 4, 5].map((score) => readonly ? (
				<span className={current >= score ? 'rating__star rating__star--active' : 'rating__star'} key={score} aria-hidden="true"><StarIcon /></span>
			) : (
				<button className={current >= score ? 'rating__star rating__star--active' : 'rating__star'} type="button" key={score} onClick={() => onChange?.(score)} aria-label={`Оценка ${score} из 5`} aria-pressed={value === score}><StarIcon /></button>
			))}
			{readonly && value == null && <span className="rating__empty">Без рейтинга</span>}
		</div>
	);
}
