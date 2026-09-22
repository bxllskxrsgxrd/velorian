import { forwardRef, type ReactNode } from 'react';

import type { ButtonIconPosition, ButtonProps } from '../../../types/button';
import './_button.scss';

function renderIcon(icon: ReactNode, position: ButtonIconPosition) {
	return (
		<span className={`button__icon button__icon--${position}`} aria-hidden="true">
			{icon}
		</span>
	);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			children,
			variant = 'filled',
			tone = 'neutral',
			size = 'medium',
			icon,
			iconPosition = 'start',
			fullWidth = false,
			isLoading = false,
			disabled = false,
			type = 'button',
			className,
			...buttonProps
		},
		ref,
	) => {
		const isDisabled = disabled || isLoading;
		const classes = [
			'button',
			`button--variant-${variant}`,
			`button--tone-${tone}`,
			`button--size-${size}`,
			fullWidth && 'button--full-width',
			isLoading && 'button--loading',
			className,
		]
			.filter(Boolean)
			.join(' ');

		return (
			<button
				{...buttonProps}
				ref={ref}
				type={type}
				className={classes}
				disabled={isDisabled}
				aria-busy={isLoading || undefined}
			>
				<span className="button__content">
					{icon && iconPosition === 'start' && renderIcon(icon, 'start')}

					<span className="button__label">{children}</span>

					{icon && iconPosition === 'end' && renderIcon(icon, 'end')}
				</span>

				{isLoading && <span className="button__loader" aria-hidden="true" />}
			</button>
		);
	},
);

Button.displayName = 'Button';
