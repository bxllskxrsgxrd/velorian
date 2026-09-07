import { useMemo, type KeyboardEvent } from 'react';
import { createStore, useStore } from 'zustand';
import { StarIcon } from '../../icons/AppIcons';
import './_rating.scss';

type RatingProps = {
	value: number | null | undefined;
	onChange?: (value: number | null) => void;
	readonly?: boolean;
	size?: 'small' | 'medium';
	ariaLabel?: string;
	/** @deprecated Use ariaLabel. */
	label?: string;
	disabled?: boolean;
	className?: string;
};

const SCORES = [1, 2, 3, 4, 5] as const;

function createRatingUiStore() {
	return createStore<{ hoverValue: number | null; setHoverValue: (value: number | null) => void }>((set) => ({
		hoverValue: null,
		setHoverValue: (hoverValue) => set({ hoverValue }),
	}));
}

export function Rating({
	value,
	onChange,
	readonly = false,
	size = 'medium',
	ariaLabel,
	label,
	disabled = false,
	className = '',
}: RatingProps) {
	const store = useMemo(() => createRatingUiStore(), []);
	const hoverValue = useStore(store, (state) => state.hoverValue);
	const setHoverValue = useStore(store, (state) => state.setHoverValue);
	const savedValue = value ?? 0;
	const displayedValue = hoverValue ?? savedValue;
	const accessibleLabel = ariaLabel ?? label ?? 'Рейтинг';
	const rootClassName = [
		'rating',
		`rating--${size}`,
		readonly && 'rating--readonly',
		disabled && 'rating--disabled',
		className,
	]
		.filter(Boolean)
		.join(' ');

	function select(score: number) {
		if (!disabled) onChange?.(savedValue === score ? null : score);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, score: number) {
		let next: number | null = null;
		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(5, score + 1);
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(1, score - 1);
		if (event.key === 'Home') next = 1;
		if (event.key === 'End') next = 5;
		if (event.key === 'Delete' || event.key === 'Backspace') next = 0;
		if (next === null) return;
		event.preventDefault();
		onChange?.(next || null);
		if (next) event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next - 1]?.focus();
	}

	return (
		<div
			className={rootClassName}
			role={readonly ? 'img' : 'group'}
			aria-label={readonly ? `${accessibleLabel}: ${value ?? 'без рейтинга'} из 5` : accessibleLabel}
			onMouseLeave={() => setHoverValue(null)}
		>
			<span className="rating__stars" aria-hidden={readonly ? 'true' : undefined}>
				{SCORES.map((score) => {
					const active = score <= displayedValue;
					const starClassName = [
						'rating__star',
						active ? 'rating__star--active' : 'rating__star--inactive',
						hoverValue !== null && active && 'rating__star--hover',
					]
						.filter(Boolean)
						.join(' ');
					return readonly ? (
						<span className={starClassName} key={score}>
							<StarIcon />
						</span>
					) : (
						<button
							className={starClassName}
							type="button"
							key={score}
							disabled={disabled}
							onMouseEnter={() => setHoverValue(score)}
							onFocus={() => setHoverValue(score)}
							onBlur={() => setHoverValue(null)}
							onClick={() => select(score)}
							onKeyDown={(event) => handleKeyDown(event, score)}
							aria-label={`Поставить рейтинг ${score} из 5`}
							aria-pressed={savedValue === score}
						>
							<StarIcon />
						</button>
					);
				})}
			</span>
		</div>
	);
}
