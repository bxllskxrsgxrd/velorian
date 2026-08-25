import { createContext, useContext } from 'react';

export type ToastKind = 'info' | 'success' | 'error';
export type ToastContextValue = { showToast: (message: string, kind?: ToastKind, durationMs?: number) => void };
export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
	const context = useContext(ToastContext);
	if (!context) throw new Error('useToast must be used inside ToastProvider');
	return context;
}
