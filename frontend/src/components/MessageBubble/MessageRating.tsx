import type { MessageRating as MessageRatingData } from '../../types/chat';
import { Rating } from '../ui/Rating/Rating';
import { useMessageUiStore } from '../../stores/messageUiStore';

type MessageRatingProps = {
	messageId: string;
	rating?: MessageRatingData | null;
	onRate: (score: number, comment?: string) => void;
	onRemove: () => void;
	onSaveToKnowledge?: () => void;
};

export function MessageRating({ messageId, rating, onRate, onRemove, onSaveToKnowledge }: MessageRatingProps) {
	const commentOpen = useMessageUiStore((state) => state.byMessageId[messageId]?.isCommentOpen ?? false);
	const comment = useMessageUiStore((state) => state.byMessageId[messageId]?.comment ?? rating?.comment ?? '');
	const toggleComment = useMessageUiStore((state) => state.toggleComment);
	const setComment = useMessageUiStore((state) => state.setComment);
	const closeComment = useMessageUiStore((state) => state.closeComment);
	return (
		<div className="message__rating" aria-label="Оценка ответа">
			<div className="message__rating-row">
				<span>Оценить:</span>
				<Rating value={rating?.score} onChange={(score) => { if (score) onRate(score, rating?.comment ?? undefined); }} label="Оценка ответа" />
				{rating && <button className="message__rating-link" type="button" onClick={() => toggleComment(messageId, rating.comment ?? '')}>Комментарий</button>}
				{rating && <button className="message__rating-link" type="button" onClick={onRemove}>Убрать</button>}
				{onSaveToKnowledge && <button className="message__rating-save" type="button" onClick={onSaveToKnowledge}>В базу знаний</button>}
			</div>
			{commentOpen && (
				<div className="message__rating-comment">
					<textarea value={comment} maxLength={2000} placeholder="Комментарий к оценке (необязательно)" onChange={(event) => setComment(messageId, event.target.value)} />
					<button type="button" onClick={() => { onRate(rating?.score ?? 5, comment); closeComment(messageId); }}>Сохранить</button>
				</div>
			)}
		</div>
	);
}
