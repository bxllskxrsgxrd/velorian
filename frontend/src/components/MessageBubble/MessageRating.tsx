import { useState } from 'react';
import type { MessageRating as MessageRatingData } from '../../types/chat';
import { Rating } from '../ui/Rating/Rating';

type MessageRatingProps = {
	rating?: MessageRatingData | null;
	onRate: (score: number, comment?: string) => void;
	onRemove: () => void;
	onSaveToKnowledge?: () => void;
};

export function MessageRating({ rating, onRate, onRemove, onSaveToKnowledge }: MessageRatingProps) {
	const [commentOpen, setCommentOpen] = useState(false);
	const [comment, setComment] = useState(rating?.comment ?? '');
	return (
		<div className="message__rating" aria-label="Оценка ответа">
			<div className="message__rating-row">
				<span>Оценить:</span>
				<Rating value={rating?.score} onChange={(score) => { if (score) onRate(score, rating?.comment ?? undefined); }} label="Оценка ответа" />
				{rating && <button className="message__rating-link" type="button" onClick={() => setCommentOpen((current) => !current)}>Комментарий</button>}
				{rating && <button className="message__rating-link" type="button" onClick={onRemove}>Убрать</button>}
				{onSaveToKnowledge && <button className="message__rating-save" type="button" onClick={onSaveToKnowledge}>В базу знаний</button>}
			</div>
			{commentOpen && (
				<div className="message__rating-comment">
					<textarea value={comment} maxLength={2000} placeholder="Комментарий к оценке (необязательно)" onChange={(event) => setComment(event.target.value)} />
					<button type="button" onClick={() => { onRate(rating?.score ?? 5, comment); setCommentOpen(false); }}>Сохранить</button>
				</div>
			)}
		</div>
	);
}
