import { forwardRef, type ButtonHTMLAttributes, type PropsWithChildren } from 'react';
import './_iconButton.scss';

interface IconButtonProps extends PropsWithChildren, ButtonHTMLAttributes<HTMLButtonElement> {}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	({ children, className = '', type = 'button', ...props }, ref) => {
		return (
			<button ref={ref} type={type} className={`icon-button ${className}`} {...props}>
				{children}
			</button>
		);
	},
);

IconButton.displayName = 'IconButton';
