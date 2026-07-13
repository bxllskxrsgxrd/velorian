import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import './_promptActionButton.scss';

interface PromptActionButtonProps extends PropsWithChildren, ButtonHTMLAttributes<HTMLButtonElement> {}

export function PromptActionButton({ children, className = '', type = 'button', ...props }: PromptActionButtonProps) {
	return (
		<button type={type} className={`prompt-action-btn ${className}`} {...props}>
			<p className="prompt-action-btn__text">{children}</p>
		</button>
	);
}
