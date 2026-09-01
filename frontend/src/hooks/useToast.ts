import { useNotificationsStore } from '../stores/notificationsStore';

export function useToast() {
	const showToast = useNotificationsStore((state) => state.showToast);
	return { showToast };
}
