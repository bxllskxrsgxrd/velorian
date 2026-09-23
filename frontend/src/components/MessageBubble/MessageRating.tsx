import type { MessageRating as MessageRatingData } from '../../types/chat';
import { Rating } from '../ui/Rating/Rating';
import { useMessageUiStore } from '../../stores/messageUiStore';

type MessageRatingProps = {
	messageId: string;
	rating?: MessageRatingData | null;
	compact?: boolean;
	readonly?: boolean;
	onRate: (score: number, comment?: string) => void;
	onRemove: () => void;
};

export function MessageRating({ messageId, rating, compact = false, readonly = false, onRate, onRemove }: MessageRatingProps) {
	const commentOpen = useMessageUiStore((state) => state.byMessageId[messageId]?.isCommentOpen ?? false);
	const comment = useMessageUiStore((state) => state.byMessageId[messageId]?.comment ?? rating?.comment ?? '');
	const toggleComment = useMessageUiStore((state) => state.toggleComment);
	const setComment = useMessageUiStore((state) => state.setComment);
	const closeComment = useMessageUiStore((state) => state.closeComment);
	return (
		<div className="message__rating" aria-label="Оценка ответа">
			<div className="message__rating-row">
				<span>Оценить:</span>
				<Rating
					value={rating?.score}
					size="small"
					readonly={readonly}
					onChange={(score) => {
						if (score) onRate(score, rating?.comment ?? undefined);
						else onRemove();
					}}
					label="Оценка ответа"
				/>
				{!readonly && !compact && rating && (
					<button
						className="message__rating-link"
						type="button"
						onClick={() => toggleComment(messageId, rating.comment ?? '')}
					>
						Комментарий
					</button>
				)}
				{!readonly && !compact && rating && (
					<button className="message__rating-link" type="button" onClick={onRemove}>
						Убрать
					</button>
				)}
			</div>
			{!readonly && !compact && commentOpen && (
				<div className="message__rating-comment">
					<textarea
						value={comment}
						maxLength={2000}
						placeholder="Комментарий к оценке (необязательно)"
						onChange={(event) => setComment(messageId, event.target.value)}
					/>
					<button
						type="button"
						onClick={() => {
							onRate(rating?.score ?? 5, comment);
							closeComment(messageId);
						}}
					>
						Сохранить
					</button>
				</div>
			)}
		</div>
	);
}
