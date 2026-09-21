import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { listKnowledge } from '../api/chatApi';
import { CrossIcon, MoreIcon, PlusIcon } from '../components/icons/AppIcons';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { CustomSelect } from '../components/ui/CustomSelect/CustomSelect';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { useToast } from '../hooks/useToast';
import { useApproachesStore } from '../stores/approachesStore';
import type { ApproachInput, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_knowledgePage.scss';
import './_approaches.scss';

const EMPTY_APPROACH: ApproachInput = {
	name: '',
	description: '',
	purpose: '',
	characteristics: [],
	structure: [],
	writingGuidelines: [],
	avoid: [],
	exampleKnowledgeItemIds: [],
	isActive: true,
};

function ListEditor({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string[];
	onChange: (value: string[]) => void;
}) {
	return (
		<fieldset className="approach-editor__list">
			<legend>{label}</legend>
			{value.length > 0 && (
				<div className="approach-editor__list-items">
					{value.map((entry, index) => (
						<div className="approach-editor__list-row" key={index}>
							<span className="approach-editor__drag-handle" aria-hidden="true">
								<MoreIcon />
							</span>
							<input
								aria-label={`${label}, пункт ${index + 1}`}
								value={entry}
								onChange={(event) =>
									onChange(value.map((item, current) => (current === index ? event.target.value : item)))
								}
							/>
							<button
								className="approach-editor__remove-item"
								type="button"
								onClick={() => onChange(value.filter((_, current) => current !== index))}
								aria-label={`Удалить пункт ${index + 1}`}
							>
								<CrossIcon />
							</button>
						</div>
					))}
				</div>
			)}
			<button className="approach-editor__add-item" type="button" onClick={() => onChange([...value, ''])}>
				<PlusIcon />
				<span>Добавить пункт</span>
			</button>
		</fieldset>
	);
}

export function ApproachEditorPage() {
	const navigate = useNavigate();
	const { approachId } = useParams<{ approachId: string }>();
	const isCreate = !approachId;
	const loadOne = useApproachesStore((state) => state.loadOne);
	const create = useApproachesStore((state) => state.create);
	const update = useApproachesStore((state) => state.update);
	const saving = useApproachesStore((state) => state.isSaving);
	const [form, setForm] = useState<ApproachInput>(EMPTY_APPROACH);
	const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
	const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_APPROACH));
	const allowNavigationRef = useRef(false);
	const { showToast } = useToast();
	const isDirty = baseline !== JSON.stringify(form);
	const blocker = useBlocker(() => isDirty && !saving && !allowNavigationRef.current);
	const availableExamples = useMemo(
		() => knowledgeItems.filter((item) => !form.exampleKnowledgeItemIds.includes(item.id)),
		[form.exampleKnowledgeItemIds, knowledgeItems],
	);

	useEffect(() => {
		function beforeUnload(event: BeforeUnloadEvent) {
			if (!isDirty || saving) return;
			event.preventDefault();
			event.returnValue = '';
		}
		window.addEventListener('beforeunload', beforeUnload);
		return () => window.removeEventListener('beforeunload', beforeUnload);
	}, [isDirty, saving]);

	useEffect(() => {
		void listKnowledge({ limit: 100 })
			.then((result) => setKnowledgeItems(result.items))
			.catch((error: unknown) => reportError('APPROACH_EXAMPLES_LOAD_FAILED', error));
	}, []);

	useEffect(() => {
		let cancelled = false;
		allowNavigationRef.current = false;
		if (isCreate) {
			// A transition from edit to new can retain the same component instance
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setBaseline(JSON.stringify(EMPTY_APPROACH));
			setForm(EMPTY_APPROACH);
			return;
		}
		if (!approachId) return;
		void loadOne(approachId)
			.then((item) => {
				if (cancelled) return;
				const next: ApproachInput = {
					name: item.name,
					description: item.description,
					purpose: item.purpose,
					characteristics: item.characteristics,
					structure: item.structure,
					writingGuidelines: item.writingGuidelines,
					avoid: item.avoid,
					exampleKnowledgeItemIds: item.exampleKnowledgeItemIds,
					isActive: item.isActive,
				};
				setBaseline(JSON.stringify(next));
				setForm(next);
			})
			.catch((error: unknown) => {
				reportError('APPROACH_LOAD_FAILED', error, { approachId });
				showToast(error instanceof Error ? error.message : 'Подход не найден', 'error');
			});
		return () => {
			cancelled = true;
		};
	}, [approachId, isCreate, loadOne, showToast]);

	function setField<K extends keyof ApproachInput>(field: K, value: ApproachInput[K]) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	function addExample(itemId: string) {
		if (!itemId) return;
		setField('exampleKnowledgeItemIds', [...form.exampleKnowledgeItemIds, itemId]);
	}

	async function save() {
		if (!form.name.trim() || saving) return;
		try {
			const saved = isCreate ? await create(form) : await update(approachId!, form);
			const clean: ApproachInput = {
				...form,
				name: saved.name,
				description: saved.description,
				purpose: saved.purpose,
				characteristics: saved.characteristics,
				structure: saved.structure,
				writingGuidelines: saved.writingGuidelines,
				avoid: saved.avoid,
				exampleKnowledgeItemIds: saved.exampleKnowledgeItemIds,
				isActive: saved.isActive,
			};
			setBaseline(JSON.stringify(clean));
			setForm(clean);
			showToast(isCreate ? 'Подход создан' : 'Подход сохранён', 'success');
			if (isCreate) {
				allowNavigationRef.current = true;
				navigate(`/knowledge/approaches/${saved.id}`, { replace: true });
			}
		} catch (error) {
			reportError('APPROACH_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить подход', 'error');
		}
	}

	return (
		<main className="approach-editor knowledge-page">
			<header>
				<div>
					<button className="approaches-page__back" type="button" onClick={() => navigate('/knowledge/approaches')}>
						← Подходы
					</button>
					<h1>{isCreate ? 'Создать подход' : 'Редактировать подход'}</h1>
				</div>
			</header>
			<div className="approach-editor__form">
				<div className="approach-editor__body">
					<label className="approach-editor__field">
						Название
						<input value={form.name} maxLength={80} onChange={(event) => setField('name', event.target.value)} />
					</label>
					<div className="approach-editor__summary">
						<label className="approach-editor__field">
							Описание
							<textarea value={form.description} onChange={(event) => setField('description', event.target.value)} />
						</label>
						<label className="approach-editor__field">
							Цель
							<textarea value={form.purpose} onChange={(event) => setField('purpose', event.target.value)} />
						</label>
					</div>
					<ListEditor
						label="Характеристики"
						value={form.characteristics}
						onChange={(value) => setField('characteristics', value)}
					/>
					<ListEditor label="Структура" value={form.structure} onChange={(value) => setField('structure', value)} />
					<ListEditor
						label="Рекомендации по написанию"
						value={form.writingGuidelines}
						onChange={(value) => setField('writingGuidelines', value)}
					/>
					<ListEditor label="Избегать" value={form.avoid} onChange={(value) => setField('avoid', value)} />
					<fieldset className="approach-editor__examples">
						<legend>Примеры из базы знаний</legend>
						<CustomSelect
							value=""
							onChange={addExample}
							ariaLabel="Материал-пример"
							options={[
								{ value: '', label: 'Выберите материал' },
								...availableExamples.map((item) => ({ value: item.id, label: item.title })),
							]}
						/>
						<ul>
							{form.exampleKnowledgeItemIds.map((id) => (
								<li key={id}>
									<span>{knowledgeItems.find((item) => item.id === id)?.title ?? id}</span>
									<button
										type="button"
										aria-label={`Удалить материал ${knowledgeItems.find((item) => item.id === id)?.title ?? id}`}
										onClick={() =>
											setField(
												'exampleKnowledgeItemIds',
												form.exampleKnowledgeItemIds.filter((item) => item !== id),
											)
										}
									>
										<CrossIcon />
									</button>
								</li>
							))}
						</ul>
					</fieldset>
					<Checkbox
						checked={form.isActive}
						onChange={(value) => setField('isActive', value)}
						label="Подход активен"
						className="approach-editor__active-toggle"
					/>
				</div>
				<div className="approach-editor__actions">
					<button type="button" disabled={saving} onClick={() => navigate('/knowledge/approaches')}>
						Отмена
					</button>
					<button
						className="approach-editor__save"
						type="button"
						disabled={!form.name.trim() || saving}
						onClick={() => void save()}
					>
						{saving ? 'Сохранение…' : 'Сохранить'}
					</button>
				</div>
			</div>
			{blocker.state === 'blocked' && (
				<ModalDialog
					title="Есть несохранённые изменения"
					confirmLabel="Выйти"
					closeLabel="Остаться"
					danger
					onClose={() => blocker.reset()}
					onConfirm={() => {
						allowNavigationRef.current = true;
						setBaseline(JSON.stringify(form));
						blocker.proceed();
					}}
				>
					<p>Несохранённые изменения будут потеряны</p>
				</ModalDialog>
			)}
		</main>
	);
}
