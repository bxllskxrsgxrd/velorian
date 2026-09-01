import { useEffect, useRef } from 'react';
import { apiFetch, subscribeConnection } from '../api/httpClient';
import { CONNECTION_RETRY_INITIAL_DELAY_MS, CONNECTION_RETRY_MAX_DELAY_MS } from '../constants/limits';

import { useNotificationsStore } from '../stores/notificationsStore';

export function useConnectionStatus() {
	const status = useNotificationsStore((state) => state.connectionStatus);
	const attempt = useNotificationsStore((state) => state.reconnectAttempt);
	const setConnection = useNotificationsStore((state) => state.setConnection);
	const timerRef = useRef<number | null>(null);
	const restoredTimerRef = useRef<number | null>(null);
	const reconnectingRef = useRef(false);
	const disconnectedRef = useRef(false);

	useEffect(() => {
		let disposed = false;
		function clearTimer() {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		function markRestored() {
			if (!disconnectedRef.current || disposed) return;
			disconnectedRef.current = false;
			setConnection('restored');
			if (restoredTimerRef.current !== null) window.clearTimeout(restoredTimerRef.current);
			restoredTimerRef.current = window.setTimeout(() => { if (!disposed) setConnection('connected'); }, 3000);
		}
		async function reconnect(currentAttempt: number) {
			if (disposed || reconnectingRef.current) return;
			timerRef.current = null;
			reconnectingRef.current = true;
			setConnection('reconnecting', currentAttempt);
			try {
				await apiFetch('/health');
				if (disposed) return;
				markRestored();
			} catch {
				if (disposed) return;
				const delay = Math.min(CONNECTION_RETRY_INITIAL_DELAY_MS * 2 ** currentAttempt, CONNECTION_RETRY_MAX_DELAY_MS);
				timerRef.current = window.setTimeout(() => void reconnect(currentAttempt + 1), delay);
			} finally {
				reconnectingRef.current = false;
			}
		}
		const unsubscribe = subscribeConnection((isConnected) => {
			if (disposed) return;
			if (isConnected) { clearTimer(); markRestored(); return; }
			disconnectedRef.current = true;
			setConnection('disconnected');
			if (!reconnectingRef.current && timerRef.current === null) timerRef.current = window.setTimeout(() => void reconnect(1), CONNECTION_RETRY_INITIAL_DELAY_MS);
		});
		const handleOffline = () => {
			disconnectedRef.current = true;
			setConnection('disconnected');
			if (timerRef.current === null) timerRef.current = window.setTimeout(() => void reconnect(1), CONNECTION_RETRY_INITIAL_DELAY_MS);
		};
		const handleOnline = () => {
			clearTimer();
			void reconnect(1);
		};
		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);
		return () => {
			disposed = true;
			clearTimer();
			if (restoredTimerRef.current !== null) window.clearTimeout(restoredTimerRef.current);
			unsubscribe();
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
		};
	}, [setConnection]);

	return { status, attempt };
}
