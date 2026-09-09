import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronIcon } from '../../icons/AppIcons';
import './_customSelect.scss';

export type CustomSelectOption = {
	value: string;
	label: string;
	disabled?: boolean;
};

type CustomSelectProps = {
	value: string;
	options: readonly CustomSelectOption[];
	onChange: (value: string) => void;
	disabled?: boolean;
	error?: boolean;
	ariaLabel: string;
	className?: string;
};

export function CustomSelect({
	value,
	options,
	onChange,
	disabled = false,
	error = false,
	ariaLabel,
	className = '',
}: CustomSelectProps) {
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const listboxId = useId();
	const selectedIndex = options.findIndex((option) => option.value === value);
	const selectedOption = options[selectedIndex] ?? options[0];
	const isOpen = open && !disabled;

	useEffect(() => {
		if (!isOpen) return;

		function handlePointerDown(event: MouseEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		}

		document.addEventListener('mousedown', handlePointerDown);
		return () => document.removeEventListener('mousedown', handlePointerDown);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen || activeIndex < 0) return;
		optionRefs.current[activeIndex]?.focus();
	}, [activeIndex, isOpen]);

	function findEnabledIndex(start: number, direction: 1 | -1) {
		for (let offset = 0; offset < options.length; offset += 1) {
			const index = (start + offset * direction + options.length) % options.length;
			if (!options[index]?.disabled) return index;
		}
		return -1;
	}

	function openMenu(preferLast = false) {
		if (disabled || options.length === 0) return;
		const initialIndex = selectedIndex >= 0
			? selectedIndex
			: findEnabledIndex(preferLast ? options.length - 1 : 0, preferLast ? -1 : 1);
		setActiveIndex(initialIndex);
		setOpen(true);
	}

	function closeMenu(restoreFocus = false) {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}

	function selectOption(index: number) {
		const option = options[index];
		if (!option || option.disabled) return;
		onChange(option.value);
		closeMenu(true);
	}

	function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			openMenu(event.key === 'ArrowUp');
		}
	}

	function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu(true);
			return;
		}
		if (event.key === 'Tab') {
			setOpen(false);
			return;
		}
		if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			setActiveIndex(findEnabledIndex(event.key === 'Home' ? 0 : options.length - 1, event.key === 'Home' ? 1 : -1));
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const direction = event.key === 'ArrowDown' ? 1 : -1;
			setActiveIndex(findEnabledIndex(index + direction, direction));
		}
	}

	return (
		<div
			className={[
				'custom-select',
				isOpen && 'custom-select--open',
				disabled && 'custom-select--disabled',
				error && 'custom-select--error',
				className,
			].filter(Boolean).join(' ')}
			ref={rootRef}
		>
			<button
				ref={triggerRef}
				className="custom-select__trigger"
				type="button"
				disabled={disabled}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				aria-controls={isOpen ? listboxId : undefined}
				aria-invalid={error || undefined}
				onClick={() => (isOpen ? closeMenu() : openMenu())}
				onKeyDown={handleTriggerKeyDown}
			>
				<span className="custom-select__value">{selectedOption?.label ?? ''}</span>
				<ChevronIcon className="custom-select__chevron" aria-hidden="true" />
			</button>

			{isOpen && (
				<div className="custom-select__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
					{options.map((option, index) => (
						<button
							key={option.value}
							ref={(element) => { optionRefs.current[index] = element; }}
							className="custom-select__option"
							type="button"
							role="option"
							aria-selected={option.value === value}
							disabled={option.disabled}
							onClick={() => selectOption(index)}
							onKeyDown={(event) => handleOptionKeyDown(event, index)}
						>
							{option.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
