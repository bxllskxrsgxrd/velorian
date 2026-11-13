import { Tooltip } from '../ui/Tooltip/Tooltip';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
});

export function KnowledgeCardMetadata({
	source,
	createdAt,
	updatedAt,
}: {
	source?: string;
	createdAt: string;
	updatedAt?: string | null;
}) {
	const createdTimestamp = new Date(createdAt).getTime();
	const updatedTimestamp = updatedAt ? new Date(updatedAt).getTime() : null;
	const wasUpdated = updatedTimestamp !== null && updatedTimestamp !== createdTimestamp;
	const createdDate = dateFormatter.format(new Date(createdAt));
	const updatedDate = updatedAt ? dateFormatter.format(new Date(updatedAt)) : null;
	const summary = wasUpdated ? `Изменено ${updatedDate}` : `Создано ${createdDate}`;

	return (
		<Tooltip
			className="knowledge-card__metadata-summary"
			content={
				<>
					{source && <span>{source}</span>}
					<span>Создано {createdDate}</span>
					{wasUpdated && <span>Изменено {updatedDate}</span>}
				</>
			}
		>
			{source ? `${source} · ${summary}` : summary}
		</Tooltip>
	);
}
