import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { ModalDialog } from '../ui/ModalDialog/ModalDialog';

export function UnsavedChangesGuard({ when }: { when: boolean }) {
	const blocker = useBlocker(() => when);

	useEffect(() => {
		function handleBeforeUnload(event: BeforeUnloadEvent) {
			if (!when) return;
			event.preventDefault();
			event.returnValue = '';
		}

		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [when]);

	if (blocker.state !== 'blocked') return null;
	return (
		<ModalDialog
			title="Есть несохранённые изменения"
			confirmLabel="Выйти"
			closeLabel="Остаться"
			danger
			onClose={() => blocker.reset()}
			onConfirm={() => blocker.proceed()}
		>
			<p>Несохранённые изменения будут потеряны</p>
		</ModalDialog>
	);
}
