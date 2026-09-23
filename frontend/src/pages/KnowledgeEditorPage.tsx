import { useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
	createKnowledgeItem,
	getKnowledgeItem,
	updateKnowledgeFile,
	updateKnowledgeItem,
	uploadKnowledgeFile,
} from '../api/chatApi';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { EMPTY_KNOWLEDGE_FILTERS } from '../constants/knowledgeFilters';
import { useToast } from '../hooks/useToast';
import { useApproachesStore } from '../stores/approachesStore';
import { useKnowledgeStore } from '../stores/knowledgeStore';
import type { KnowledgeCreateSource, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import { KnowledgeDataEditor } from './KnowledgePage';

function itemFilters(item: KnowledgeItem) {
	return item.filters ?? { ...EMPTY_KNOWLEDGE_FILTERS };
}

function fingerprint(value: {
	title: string;
	content: string;
	rating: number | null;
	isActive: boolean;
	approachId: string;
	filters: typeof EMPTY_KNOWLEDGE_FILTERS;
	file: File | null;
}) {
	return JSON.stringify({
		...value,
		file: value.file ? [value.file.name, value.file.size, value.file.lastModified] : null,
	});
}

export function KnowledgeEditorPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { knowledgeId } = useParams<{ knowledgeId: string }>();
	const isCreate = !knowledgeId;
	const createSource = (location.state as { knowledgeSource?: KnowledgeCreateSource } | null)?.knowledgeSource;
	const items = useKnowledgeStore((state) => state.items);
	const item = knowledgeId ? items.find((entry) => entry.id === knowledgeId) : undefined;
	const upsertItem = useKnowledgeStore((state) => state.upsertItem);
	const title = useKnowledgeStore((state) => state.title);
	const setTitle = useKnowledgeStore((state) => state.setTitle);
	const content = useKnowledgeStore((state) => state.content);
	const setContent = useKnowledgeStore((state) => state.setContent);
	const rating = useKnowledgeStore((state) => state.rating);
	const setRating = useKnowledgeStore((state) => state.setRating);
	const isActive = useKnowledgeStore((state) => state.isActive);
	const setIsActive = useKnowledgeStore((state) => state.setActive);
	const selectedApproachId = useKnowledgeStore((state) => state.selectedApproachId);
	const setSelectedApproachId = useKnowledgeStore((state) => state.setSelectedApproachId);
	const formFilters = useKnowledgeStore((state) => state.formFilters);
	const setFormFilters = useKnowledgeStore((state) => state.setFormFilters);
	const file = useKnowledgeStore((state) => state.file);
	const setFile = useKnowledgeStore((state) => state.setFile);
	const saving = useKnowledgeStore((state) => state.isSaving);
	const setSaving = useKnowledgeStore((state) => state.setSaving);
	const approaches = useApproachesStore((state) => state.items);
	const loadApproaches = useApproachesStore((state) => state.load);
	const { showToast } = useToast();
	const [baseline, setBaseline] = useState('');
	const allowNavigationRef = useRef(false);
	const currentFingerprint = fingerprint({
		title,
		content,
		rating,
		isActive,
		approachId: selectedApproachId,
		filters: formFilters,
		file,
	});
	const isDirty = Boolean(baseline) && baseline !== currentFingerprint;
	const blocker = useBlocker(() => isDirty && !saving && !allowNavigationRef.current);

	useEffect(() => {
		function handleBeforeUnload(event: BeforeUnloadEvent) {
			if (!isDirty || saving) return;
			event.preventDefault();
			event.returnValue = '';
		}
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [isDirty, saving]);

	useEffect(() => {
		void loadApproaches().catch((error: unknown) => {
			reportError('KNOWLEDGE_APPROACHES_FAILED', error);
			showToast('Не удалось загрузить подходы', 'error');
		});
	}, [loadApproaches, showToast]);

	useEffect(() => {
		let cancelled = false;
		allowNavigationRef.current = false;
		if (isCreate) {
			const sourceFile = createSource?.type === 'assistant_file' && createSource.fileName
				? new File([createSource.content], createSource.fileName, { type: createSource.mimeType || 'text/markdown' })
				: null;
			const initial = {
				title: createSource?.title ?? '',
				content: createSource?.content ?? '',
				rating: createSource?.rating ?? null,
				isActive: true,
				approachId: '',
				filters: { ...EMPTY_KNOWLEDGE_FILTERS },
				file: sourceFile,
			};
			// Route changes can reuse this component instance, so reset the comparison snapshot too
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setBaseline(fingerprint(initial));
			setTitle(initial.title);
			setContent(initial.content);
			setRating(initial.rating);
			setIsActive(initial.isActive);
			setSelectedApproachId(initial.approachId);
			setFormFilters(initial.filters);
			setFile(sourceFile);
			return;
		}
		if (!knowledgeId) return;
		getKnowledgeItem(knowledgeId)
			.then((loaded) => {
				if (cancelled) return;
				upsertItem(loaded);
				const initial = {
					title: loaded.title,
					content: loaded.content,
					rating: loaded.rating,
					isActive: loaded.isActive,
					approachId: loaded.approach?.id ?? '',
					filters: itemFilters(loaded),
					file: null,
				};
				setBaseline(fingerprint(initial));
				setTitle(initial.title);
				setContent(initial.content);
				setRating(initial.rating);
				setIsActive(initial.isActive);
				setSelectedApproachId(initial.approachId);
				setFormFilters(initial.filters);
				setFile(null);
			})
			.catch((error: unknown) => {
				reportError('KNOWLEDGE_LOAD_FAILED', error, { knowledgeId });
				showToast(error instanceof Error ? error.message : 'Материал не найден', 'error');
			});
		return () => {
			cancelled = true;
		};
	}, [
		createSource,
		isCreate,
		knowledgeId,
		setContent,
		setFile,
		setFormFilters,
		setIsActive,
		setRating,
		setSelectedApproachId,
		setTitle,
		showToast,
		upsertItem,
	]);

	async function save() {
		if (saving || !title.trim()) return;
		setSaving(true);
		try {
			const saved = isCreate
				? createSource
					? await createKnowledgeItem(title.trim(), content, rating, isActive, selectedApproachId || null, formFilters, createSource)
					: file
					? await uploadKnowledgeFile(
							file,
							title.trim(),
							content,
							rating,
							isActive,
							selectedApproachId || null,
							formFilters,
						)
					: await createKnowledgeItem(title.trim(), content, rating, isActive, selectedApproachId || null, formFilters)
				: file
					? await updateKnowledgeFile(
							knowledgeId!,
							file,
							title.trim(),
							content,
							rating,
							isActive,
							selectedApproachId || null,
							formFilters,
						)
					: await updateKnowledgeItem(knowledgeId!, {
							title: title.trim(),
							content,
							rating,
							isActive,
							approachId: selectedApproachId || null,
							filters: formFilters,
						});
			upsertItem(saved);
			setFile(null);
			setBaseline(
				fingerprint({
					title: saved.title,
					content: saved.content,
					rating: saved.rating,
					isActive: saved.isActive,
					approachId: saved.approach?.id ?? '',
					filters: itemFilters(saved),
					file: null,
				}),
			);
			showToast(isCreate ? 'Данные добавлены в базу знаний' : 'Изменения сохранены', 'success');
			if (isCreate) {
				allowNavigationRef.current = true;
				navigate(createSource?.returnTo ?? `/knowledge/${saved.id}`, { replace: true });
			}
		} catch (error) {
			reportError('KNOWLEDGE_SAVE_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось сохранить данные', 'error');
		} finally {
			setSaving(false);
		}
	}

	if (!isCreate && !item)
		return (
			<main className="knowledge-editor-page knowledge-page">
				<p>Загрузка материала…</p>
			</main>
		);

	return (
		<>
			<KnowledgeDataEditor
				mode={isCreate ? 'create' : 'edit'}
				item={item}
				title={title}
				setTitle={setTitle}
				content={content}
				setContent={setContent}
				rating={rating}
				setRating={setRating}
				isActive={isActive}
				setIsActive={setIsActive}
				selectedApproachId={selectedApproachId}
				setSelectedApproachId={setSelectedApproachId}
				formFilters={formFilters}
				setFormFilters={setFormFilters}
				approaches={approaches}
				file={file}
				setFile={setFile}
				saving={saving}
				onCancel={() => navigate(createSource?.returnTo ?? '/knowledge')}
				onConfirm={() => void save()}
			/>
			{blocker.state === 'blocked' && (
				<ModalDialog
					title="Есть несохранённые изменения"
					confirmLabel="Выйти"
					closeLabel="Остаться"
					danger
					onClose={() => blocker.reset()}
					onConfirm={() => {
						allowNavigationRef.current = true;
						setBaseline(currentFingerprint);
						blocker.proceed();
					}}
				>
					<p>Несохранённые изменения будут потеряны</p>
				</ModalDialog>
			)}
		</>
	);
}
