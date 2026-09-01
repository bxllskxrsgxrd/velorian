import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';
export type Toast = { id: string; message: string; kind: ToastKind };
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'restored';

type NotificationsStore = {
	toasts: Toast[];
	connectionStatus: ConnectionStatus;
	reconnectAttempt: number;
	showToast: (message: string, kind?: ToastKind, durationMs?: number) => void;
	dismissToast: (id: string) => void;
	setConnection: (status: ConnectionStatus, attempt?: number) => void;
};

export const useNotificationsStore = create<NotificationsStore>((set) => ({
	toasts: [],
	connectionStatus: 'connected',
	reconnectAttempt: 0,
	showToast: (message, kind = 'info', durationMs = 3500) => {
		const id = crypto.randomUUID();
		set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
		window.setTimeout(() => {
			set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
		}, durationMs);
	},
	dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
	setConnection: (connectionStatus, reconnectAttempt = 0) => set({ connectionStatus, reconnectAttempt }),
}));
