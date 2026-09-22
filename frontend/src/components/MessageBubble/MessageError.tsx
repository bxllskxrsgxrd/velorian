import { ErrorIcon, RefreshIcon } from '../icons/AppIcons';
import type { ChatMessageError } from '../../types/chat';
import { Button } from '../ui/Button/Button';

type MessageErrorProps = {
	error: ChatMessageError;
	onRetry?: () => void;
};

export function MessageError({ error, onRetry }: MessageErrorProps) {
	return (
		<div className="message__error">
			<span className="message__error-icon" aria-hidden="true">
				<ErrorIcon />
			</span>
			<div className="message__error-content">
				<strong className="message__error-title">{error.title}</strong>
				<span className="message__error-description">{error.description}</span>
				{error.requestId && <small className="message__error-request-id">Код обращения: {error.requestId}</small>}
				{error.retryable && onRetry && (
					<div className="message__error-actions">
						<Button variant="filled" tone="neutral" size="medium" icon={<RefreshIcon />} onClick={onRetry}>
							Повторить
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
