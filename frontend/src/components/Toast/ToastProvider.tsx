import type { ReactNode } from 'react';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { useNotificationsStore } from '../../stores/notificationsStore';
import './_toast.scss';

function ConnectionToast() {
	const { status, attempt } = useConnectionStatus();
	if (status === 'connected') return null;
	const message = status === 'disconnected' ? 'Соединение потеряно. Пытаемся восстановить…'
		: status === 'reconnecting' ? `Переподключение… Попытка ${attempt}` : 'Соединение восстановлено';
	return <div className={`toast toast--${status === 'restored' ? 'success' : 'info'}`} role="status">{message}</div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const toasts = useNotificationsStore((state) => state.toasts);
	return <>{children}<div className="toast-region" aria-live="polite"><ConnectionToast />{toasts.map((toast) => <div className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>{toast.message}</div>)}</div></>;
}
