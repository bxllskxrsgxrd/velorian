import { useId, type ReactNode } from 'react';
import './_tooltip.scss';

type TooltipProps = {
	children: ReactNode;
	content: ReactNode;
	className?: string;
};

export function Tooltip({ children, content, className = '' }: TooltipProps) {
	const tooltipId = useId();

	return (
		<span className={['ui-tooltip', className].filter(Boolean).join(' ')} tabIndex={0} aria-describedby={tooltipId}>
			{children}
			<span className="ui-tooltip__content" id={tooltipId} role="tooltip">
				{content}
			</span>
		</span>
	);
}
