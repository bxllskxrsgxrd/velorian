import { TrashIcon } from '../icons/AppIcons';
import { Button } from '../ui/Button/Button';

type BulkSelectionBarProps = {
	selectedCount: number;
	totalCount: number;
	onSelectAll: () => void;
	onClear: () => void;
	onDelete: () => void;
	deleteLabel?: string;
	ariaLabel?: string;
};

export function BulkSelectionBar({
	selectedCount,
	totalCount,
	onSelectAll,
	onClear,
	onDelete,
	deleteLabel = `В корзину ${selectedCount}`,
	ariaLabel = 'Действия с выбранными элементами',
}: BulkSelectionBarProps) {
	return (
		<div className="knowledge-page__bulk-slot">
			{selectedCount > 0 && (
				<div className="knowledge-page__bulk-bar" role="region" aria-label={ariaLabel}>
					<strong>Выбрано: {selectedCount}</strong>
					<Button
						variant="outline"
						tone="neutral"
						size="small"
						disabled={selectedCount === totalCount}
						onClick={onSelectAll}
					>
						Выбрать все {totalCount}
					</Button>

					<Button variant="outline" tone="neutral" size="small" onClick={onClear}>
						Снять выбор
					</Button>

					<Button variant="outline" tone="danger" size="small" icon={<TrashIcon />} onClick={onDelete}>
						{deleteLabel}
					</Button>
				</div>
			)}
		</div>
	);
}
