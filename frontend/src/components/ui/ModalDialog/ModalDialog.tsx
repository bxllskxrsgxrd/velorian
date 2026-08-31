import type { ReactNode } from 'react';
import './_modalDialog.scss';

type ModalDialogProps = {
	title: string;
	children: ReactNode;
	confirmLabel: string;
	danger?: boolean;
	confirmDisabled?: boolean;
	onConfirm: () => void;
	onClose: () => void;
};

export function ModalDialog({ title, children, confirmLabel, danger, confirmDisabled, onConfirm, onClose }: ModalDialogProps) {
	return (
		<div className="modal-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<div className="modal-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="modal-dialog-title">
				<h2 id="modal-dialog-title">{title}</h2>
				<div className="modal-dialog__content">{children}</div>
				<div className="modal-dialog__actions">
					<button type="button" onClick={onClose}>Отмена</button>
					<button className={danger ? 'modal-dialog__confirm modal-dialog__confirm--danger' : 'modal-dialog__confirm'} type="button" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
				</div>
			</div>
		</div>
	);
}
