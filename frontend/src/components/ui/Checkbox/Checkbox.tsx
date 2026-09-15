import { useEffect, useRef } from 'react';
import { CheckIcon } from '../../icons/AppIcons';
import './_checkbox.scss';

type CheckboxProps = {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	disabled?: boolean;
	indeterminate?: boolean;
	className?: string;
};

export function Checkbox({
	checked,
	onChange,
	label,
	disabled = false,
	indeterminate = false,
	className = '',
}: CheckboxProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (inputRef.current) inputRef.current.indeterminate = indeterminate;
	}, [indeterminate]);

	return (
		<label className={['checkbox', disabled && 'checkbox--disabled', className].filter(Boolean).join(' ')}>
			<input
				ref={inputRef}
				className="checkbox__input"
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => { if (!disabled) onChange(event.currentTarget.checked); }}
			/>
			<span className="checkbox__control" aria-hidden="true">
				{indeterminate && !disabled ? <span className="checkbox__indeterminate" /> : checked && !disabled && <CheckIcon />}
			</span>
			<span className="checkbox__label">{label}</span>
		</label>
	);
}
