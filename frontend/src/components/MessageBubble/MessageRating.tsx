import { useState } from 'react';
import type { MessageRating as MessageRatingData } from '../../types/chat';
import { StarIcon } from '../icons/AppIcons';

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
				{[1, 2, 3, 4, 5].map((score) => (
					<button className={(rating?.score ?? 0) >= score ? 'message__rating-star message__rating-star--active' : 'message__rating-star'} type="button" key={score} onClick={() => onRate(score, rating?.comment ?? undefined)} aria-label={`Оценка ${score} из 5`} aria-pressed={rating?.score === score}><StarIcon /></button>
				))}
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
