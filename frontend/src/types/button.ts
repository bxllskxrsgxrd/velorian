import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'filled' | 'outline' | 'ghost';

export type ButtonTone = 'neutral' | 'accent' | 'danger';

export type ButtonSize = 'small' | 'medium' | 'large';

export type ButtonIconPosition = 'start' | 'end';

export type ButtonVisualProps = {
	variant?: ButtonVariant;
	tone?: ButtonTone;
	size?: ButtonSize;
	fullWidth?: boolean;
	icon?: ReactNode;
	iconPosition?: ButtonIconPosition;
	isLoading?: boolean;
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> &
	ButtonVisualProps & {
		children: ReactNode;
	};
