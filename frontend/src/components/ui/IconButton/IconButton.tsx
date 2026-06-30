import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import './_iconButton.scss';

interface IconButtonProps extends PropsWithChildren, ButtonHTMLAttributes<HTMLButtonElement> {}

export function IconButton({ children, className = '', type = 'button', ...props }: IconButtonProps) {
	return (
		<button type={type} className={`icon-button ${className}`} {...props}>
			{children}
		</button>
	);
}
