import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { ToastContext, type ToastKind } from './ToastContext';
import './_toast.scss';

type Toast = { id: string; message: string; kind: ToastKind };

function ConnectionToast() {
	const { status, attempt } = useConnectionStatus();
	if (status === 'connected') return null;
	const message = status === 'disconnected' ? 'Соединение потеряно. Пытаемся восстановить…'
		: status === 'reconnecting' ? `Переподключение… Попытка ${attempt}` : 'Соединение восстановлено';
	return <div className={`toast toast--${status === 'restored' ? 'success' : 'info'}`} role="status">{message}</div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const timersRef = useRef(new Set<number>());
	useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);
	const showToast = useCallback((message: string, kind: ToastKind = 'info', durationMs = 3500) => {
		const id = crypto.randomUUID();
		setToasts((current) => [...current, { id, message, kind }]);
		const timer = window.setTimeout(() => {
			setToasts((current) => current.filter((toast) => toast.id !== id));
			timersRef.current.delete(timer);
		}, durationMs);
		timersRef.current.add(timer);
	}, []);
	const value = useMemo(() => ({ showToast }), [showToast]);
	return <ToastContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite"><ConnectionToast />{toasts.map((toast) => <div className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>{toast.message}</div>)}</div></ToastContext.Provider>;
}
