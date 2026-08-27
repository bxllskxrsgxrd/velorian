import { CheckIcon } from '../../icons/AppIcons';
import './_checkbox.scss';

type CheckboxProps = {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	disabled?: boolean;
	className?: string;
};

export function Checkbox({ checked, onChange, label, disabled = false, className = '' }: CheckboxProps) {
	return (
		<label className={['checkbox', disabled && 'checkbox--disabled', className].filter(Boolean).join(' ')}>
			<input
				className="checkbox__input"
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => { if (!disabled) onChange(event.currentTarget.checked); }}
			/>
			<span className="checkbox__control" aria-hidden="true">{checked && !disabled && <CheckIcon />}</span>
			<span className="checkbox__label">{label}</span>
		</label>
	);
}
