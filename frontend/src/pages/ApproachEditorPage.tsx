import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { listKnowledge } from '../api/chatApi';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { CustomSelect } from '../components/ui/CustomSelect/CustomSelect';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { useToast } from '../hooks/useToast';
import { useApproachesStore } from '../stores/approachesStore';
import type { ApproachInput, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_approaches.scss';

const EMPTY_APPROACH: ApproachInput = {
	name: '', description: '', purpose: '', characteristics: [], structure: [], writingGuidelines: [], avoid: [], exampleKnowledgeItemIds: [], isActive: true,
};

function ListEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
	return (
		<fieldset className="approach-editor__list">
			<legend>{label}</legend>
			{value.map((entry, index) => (
				<div key={index}>
					<input value={entry} onChange={(event) => onChange(value.map((item, current) => current === index ? event.target.value : item))} />
					<button type="button" onClick={() => onChange(value.filter((_, current) => current !== index))} aria-label={`Удалить пункт ${index + 1}`}>×</button>
				</div>
			))}
			<button type="button" onClick={() => onChange([...value, ''])}>Добавить пункт</button>
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
	const remove = useApproachesStore((state) => state.delete);
	const saving = useApproachesStore((state) => state.isSaving);
	const [form, setForm] = useState<ApproachInput>(EMPTY_APPROACH);
	const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
	const [exampleCandidate, setExampleCandidate] = useState('');
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_APPROACH));
	const allowNavigationRef = useRef(false);
	const { showToast } = useToast();
	const isDirty = baseline !== JSON.stringify(form);
	const blocker = useBlocker(() => isDirty && !saving && !allowNavigationRef.current);
	const availableExamples = useMemo(() => knowledgeItems.filter((item) => !form.exampleKnowledgeItemIds.includes(item.id)), [form.exampleKnowledgeItemIds, knowledgeItems]);

	useEffect(() => {
		if (blocker.state !== 'blocked') return;
		if (window.confirm('Есть несохранённые изменения. Покинуть страницу?')) blocker.proceed();
		else blocker.reset();
	}, [blocker]);

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
		void listKnowledge({ limit: 100 }).then((result) => setKnowledgeItems(result.items)).catch((error: unknown) => reportError('APPROACH_EXAMPLES_LOAD_FAILED', error));
	}, []);

	useEffect(() => {
		let cancelled = false;
		allowNavigationRef.current = false;
		if (isCreate) {
			// A transition from edit to new can retain the same component instance.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setBaseline(JSON.stringify(EMPTY_APPROACH));
			setForm(EMPTY_APPROACH);
			return;
		}
		if (!approachId) return;
		void loadOne(approachId).then((item) => {
			if (cancelled) return;
			const next: ApproachInput = {
				name: item.name, description: item.description, purpose: item.purpose,
				characteristics: item.characteristics, structure: item.structure,
				writingGuidelines: item.writingGuidelines, avoid: item.avoid,
				exampleKnowledgeItemIds: item.exampleKnowledgeItemIds, isActive: item.isActive,
			};
			setBaseline(JSON.stringify(next));
			setForm(next);
		}).catch((error: unknown) => {
			reportError('APPROACH_LOAD_FAILED', error, { approachId });
			showToast(error instanceof Error ? error.message : 'Подход не найден', 'error');
		});
		return () => { cancelled = true; };
	}, [approachId, isCreate, loadOne, showToast]);

	function setField<K extends keyof ApproachInput>(field: K, value: ApproachInput[K]) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	async function save() {
		if (!form.name.trim() || saving) return;
		try {
			const saved = isCreate ? await create(form) : await update(approachId!, form);
			const clean: ApproachInput = { ...form, name: saved.name, description: saved.description, purpose: saved.purpose, characteristics: saved.characteristics, structure: saved.structure, writingGuidelines: saved.writingGuidelines, avoid: saved.avoid, exampleKnowledgeItemIds: saved.exampleKnowledgeItemIds, isActive: saved.isActive };
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

	async function deleteCurrent() {
		if (!approachId) return;
		try {
			await remove(approachId);
			allowNavigationRef.current = true;
			navigate('/knowledge/approaches', { replace: true });
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось удалить подход', 'error');
		}
	}

	return (
		<main className="approach-editor knowledge-page">
			<header>
				<div><button className="approaches-page__back" type="button" onClick={() => navigate('/knowledge/approaches')}>← Подходы</button><h1>{isCreate ? 'Создать подход' : 'Редактировать подход'}</h1></div>
				<div className="approach-editor__actions">
					{!isCreate && <button className="approach-editor__delete" type="button" onClick={() => setDeleteOpen(true)}>Удалить</button>}
					<button type="button" disabled={!form.name.trim() || saving} onClick={() => void save()}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
				</div>
			</header>
			<div className="approach-editor__form">
				<label>Название<input value={form.name} maxLength={80} onChange={(event) => setField('name', event.target.value)} /></label>
				<label>Описание<textarea value={form.description} onChange={(event) => setField('description', event.target.value)} /></label>
				<label>Цель<textarea value={form.purpose} onChange={(event) => setField('purpose', event.target.value)} /></label>
				<ListEditor label="Характеристики" value={form.characteristics} onChange={(value) => setField('characteristics', value)} />
				<ListEditor label="Структура" value={form.structure} onChange={(value) => setField('structure', value)} />
				<ListEditor label="Рекомендации по написанию" value={form.writingGuidelines} onChange={(value) => setField('writingGuidelines', value)} />
				<ListEditor label="Избегать" value={form.avoid} onChange={(value) => setField('avoid', value)} />
				<fieldset className="approach-editor__examples">
					<legend>Примеры из базы знаний</legend>
					<div><CustomSelect value={exampleCandidate} onChange={setExampleCandidate} ariaLabel="Материал-пример" options={[{ value: '', label: 'Выберите материал' }, ...availableExamples.map((item) => ({ value: item.id, label: item.title }))]} /><button type="button" disabled={!exampleCandidate} onClick={() => { setField('exampleKnowledgeItemIds', [...form.exampleKnowledgeItemIds, exampleCandidate]); setExampleCandidate(''); }}>Добавить</button></div>
					<ul>{form.exampleKnowledgeItemIds.map((id) => <li key={id}><span>{knowledgeItems.find((item) => item.id === id)?.title ?? id}</span><button type="button" onClick={() => setField('exampleKnowledgeItemIds', form.exampleKnowledgeItemIds.filter((item) => item !== id))}>Удалить</button></li>)}</ul>
				</fieldset>
				<Checkbox checked={form.isActive} onChange={(value) => setField('isActive', value)} label="Подход активен" />
			</div>
			{deleteOpen && <ModalDialog title="Удалить подход?" confirmLabel="Удалить" danger onClose={() => setDeleteOpen(false)} onConfirm={() => void deleteCurrent()}><p>Если подход используется, он будет деактивирован и связи материалов сохранятся.</p></ModalDialog>}
		</main>
	);
}
