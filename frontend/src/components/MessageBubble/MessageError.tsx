import { ErrorIcon } from '../icons/AppIcons';

type MessageErrorProps = {
	message: string;
	requestId?: string;
	onRetry?: () => void;
};

export function MessageError({ message, requestId, onRetry }: MessageErrorProps) {
	return (
		<div className="message__error-card" role="alert" aria-live="assertive">
			<span className="message__error-icon"><ErrorIcon /></span>
			<div className="message__error-copy">
				<strong>Не удалось получить ответ</strong>
				<span>{message || 'Попробуйте повторить запрос через несколько секунд.'}</span>
				{requestId && <small>Код обращения: {requestId}</small>}
			</div>
			{onRetry && <button type="button" onClick={onRetry}>Повторить</button>}
		</div>
	);
}
