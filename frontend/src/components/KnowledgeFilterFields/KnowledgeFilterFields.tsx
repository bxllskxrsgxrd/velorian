import type { KnowledgeFilters } from '../../types/chat';

type KnowledgeFilterFieldsProps = {
	value: KnowledgeFilters;
	onChange: (value: KnowledgeFilters) => void;
	disabled?: boolean;
};

const fields: Array<{ key: keyof KnowledgeFilters; label: string; placeholder: string }> = [
	{ key: 'geo', label: 'ГЕО', placeholder: 'Например, UK' },
	{ key: 'celebrity', label: 'Селеба', placeholder: 'Например, Andrew Bailey' },
	{ key: 'offer', label: 'Оффер', placeholder: 'Например, Pixum AI' },
	{ key: 'news_source', label: 'Новостник', placeholder: 'Например, BBC' },
];

export function KnowledgeFilterFields({ value, onChange, disabled = false }: KnowledgeFilterFieldsProps) {
	return <div className="knowledge-filter-fields">
		{fields.map((field) => <label key={field.key}>{field.label}
			<input
				value={value[field.key] ?? ''}
				placeholder={field.placeholder}
				maxLength={160}
				disabled={disabled}
				onChange={(event) => onChange({ ...value, [field.key]: event.target.value || null })}
			/>
		</label>)}
	</div>;
}
