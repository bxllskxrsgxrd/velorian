import type { ReactNode } from 'react';
import './_modalDialog.scss';
import { IconButton } from '../IconButton/IconButton';
import { CrossIcon } from '../../icons/AppIcons';

type ModalDialogProps = {
	title: string;
	children: ReactNode;
	confirmLabel: string;
	className?: string;
	subtitle?: string;
	showCloseButton?: boolean;
	danger?: boolean;
	confirmDisabled?: boolean;
	closeDisabled?: boolean;
	onConfirm: () => void;
	onClose: () => void;
};

export function ModalDialog({
	title,
	children,
	confirmLabel,
	className = '',
	subtitle,
	showCloseButton = false,
	danger,
	confirmDisabled = false,
	closeDisabled = false,
	onConfirm,
	onClose,
}: ModalDialogProps) {
	return (
		<div
			className={['modal-dialog', className].filter(Boolean).join(' ')}
			role="presentation"
			onMouseDown={(event) => {
				if (!closeDisabled && event.target === event.currentTarget) onClose();
			}}
		>
			<div className="modal-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="modal-dialog-title">
				{subtitle || showCloseButton ? (
					<div className="modal-dialog__header">
						<div>
							<h2 id="modal-dialog-title">{title}</h2>
							{subtitle && <p className="modal-dialog__subtitle">{subtitle}</p>}
						</div>
						{showCloseButton && (
							<IconButton
								className="modal-dialog__close"
								disabled={closeDisabled}
								onClick={onClose}
								aria-label="Закрыть"
							>
								<CrossIcon />
							</IconButton>
						)}
					</div>
				) : (
					<h2 id="modal-dialog-title">{title}</h2>
				)}
				<div className="modal-dialog__content">{children}</div>
				<div className="modal-dialog__actions">
					<button type="button" disabled={closeDisabled} onClick={onClose}>
						{confirmDisabled && !closeDisabled ? 'Закрыть' : 'Отмена'}
					</button>
					<button
						disabled={confirmDisabled}
						className={danger ? 'modal-dialog__confirm modal-dialog__confirm--danger' : 'modal-dialog__confirm'}
						type="button"
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
