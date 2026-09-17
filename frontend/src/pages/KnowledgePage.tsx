import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
	deleteKnowledgeItem,
	listKnowledge,
	updateKnowledgeItem,
} from '../api/chatApi';
import { useDebounce } from '../hooks/useDebounce';
import { useToast } from '../hooks/useToast';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Rating } from '../components/ui/Rating/Rating';
import { Checkbox } from '../components/ui/Checkbox/Checkbox';
import { CustomSelect } from '../components/ui/CustomSelect/CustomSelect';
import { DropZone } from '../components/ui/DropZone/DropZone';
import { Tooltip } from '../components/ui/Tooltip/Tooltip';
import { KnowledgeFilterFields } from '../components/KnowledgeFilterFields/KnowledgeFilterFields';
import type { AuthUser, KnowledgeApproach, KnowledgeFilters, KnowledgeItem } from '../types/chat';
import { reportError } from '../utils/reportError';
import { useKnowledgeStore } from '../stores/knowledgeStore';
import { useUiStore } from '../stores/uiStore';
import { useApproachesStore } from '../stores/approachesStore';
import './_knowledgePage.scss';
import { CrossIcon, DocumentIcon, ListIcon, SearchIcon, TrashIcon } from '../components/icons/AppIcons';

const MarkdownEditor = lazy(() => import('../components/MarkdownEditor/MarkdownEditor'));

type RatingFilter = 'all' | '5' | '4' | '3' | 'unrated';
type SortMode = 'date_desc' | 'date_asc' | 'rating_desc' | 'rating_asc';
type FilePreviewState = { status: 'idle' | 'loading' | 'ready' | 'error'; content: string };
type KnowledgeCardMenuState = { itemId: string; top: number; left: number };

const TEXT_FILE_EXTENSIONS = new Set([
	'.txt',
	'.md',
	'.json',
	'.csv',
	'.log',
	'.html',
	'.css',
	'.scss',
	'.sass',
	'.less',
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.xml',
	'.yaml',
	'.yml',
	'.toml',
	'.ini',
	'.env',
	'.py',
	'.rb',
	'.php',
	'.java',
	'.kt',
	'.kts',
	'.swift',
	'.go',
	'.rs',
	'.c',
	'.h',
	'.cpp',
	'.hpp',
	'.cs',
	'.sql',
	'.sh',
	'.bash',
	'.zsh',
	'.vue',
	'.svelte',
]);

function extractionStatusLabel(item: KnowledgeItem) {
	if (item.sourceType !== 'uploaded_file') return null;
	const status = item.metadata.extractionStatus;
	if (status === 'empty') return 'Файл не содержит извлекаемого текста';
	if (status === 'ocr_unavailable') return 'Текст изображения не извлечён: OCR недоступен';
	if (status === 'unsupported') return 'Извлечение текста для формата не поддерживается';
	return null;
}

const knowledgeDateFormatter = new Intl.DateTimeFormat('ru-RU', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
});

function knowledgeSourceLabel(sourceType: KnowledgeItem['sourceType']) {
	if (sourceType === 'rated_content') return 'Ответ агента';
	if (sourceType === 'assistant_file') return 'Файл из диалога';
	if (sourceType === 'uploaded_file') return 'Файл';
	return 'Добавлено вручную';
}

function KnowledgeCardMetadata({
	source,
	createdAt,
	updatedAt,
}: {
	source: string;
	createdAt: string;
	updatedAt?: string | null;
}) {
	const createdTimestamp = new Date(createdAt).getTime();
	const updatedTimestamp = updatedAt ? new Date(updatedAt).getTime() : null;
	const wasUpdated = updatedTimestamp !== null && updatedTimestamp !== createdTimestamp;
	const createdDate = knowledgeDateFormatter.format(new Date(createdAt));
	const updatedDate = updatedAt ? knowledgeDateFormatter.format(new Date(updatedAt)) : null;

	return (
		<Tooltip
			className="knowledge-card__metadata-summary"
			content={
				<>
					<span>{source}</span>
					<span>Создано {createdDate}</span>
					{wasUpdated && <span>Изменено {updatedDate}</span>}
				</>
			}
		>
			{source} · {wasUpdated ? `Изменено ${updatedDate}` : `Создано ${createdDate}`}
		</Tooltip>
	);
}

function storedFilters(item: KnowledgeItem): KnowledgeFilters {
	return (
		item.filters ?? {
			geo: typeof item.metadata?.geo === 'string' ? item.metadata.geo : null,
			celebrity: typeof item.metadata?.celebrity === 'string' ? item.metadata.celebrity : null,
			offer: typeof item.metadata?.offer === 'string' ? item.metadata.offer : null,
			news_source: typeof item.metadata?.news_source === 'string' ? item.metadata.news_source : null,
		}
	);
}

export type KnowledgeDataEditorProps = {
	mode: 'create' | 'edit';
	item?: KnowledgeItem;
	title: string;
	setTitle: (value: string) => void;
	content: string;
	setContent: (value: string) => void;
	rating: number | null;
	setRating: (value: number | null) => void;
	isActive: boolean;
	setIsActive: (value: boolean) => void;
	selectedApproachId: string;
	setSelectedApproachId: (value: string) => void;
	formFilters: KnowledgeFilters;
	setFormFilters: (value: KnowledgeFilters) => void;
	approaches: KnowledgeApproach[];
	file: File | null;
	setFile: (value: File | null) => void;
	saving: boolean;
	onCancel: () => void;
	onConfirm: () => void;
};

export function KnowledgeDataEditor({
	mode,
	item,
	title,
	setTitle,
	content,
	setContent,
	rating,
	setRating,
	isActive,
	setIsActive,
	selectedApproachId,
	setSelectedApproachId,
	formFilters,
	setFormFilters,
	approaches,
	file,
	setFile,
	saving,
	onCancel,
	onConfirm,
}: KnowledgeDataEditorProps) {
	const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
	const [filePreview, setFilePreview] = useState<FilePreviewState>({ status: 'idle', content: '' });
	const fileInputRef = useRef<HTMLInputElement>(null);
	const filePreviewRequestRef = useRef(0);
	const selectedApproachName = selectedApproachId
		? (approaches.find((approach) => approach.id === selectedApproachId)?.name ??
			(item?.approach?.id === selectedApproachId ? item.approach.name : null))
		: null;
	const previewMetadata = [
		{ label: 'ГЕО', value: formFilters.geo },
		{ label: 'Селеба', value: formFilters.celebrity },
		{ label: 'Оффер', value: formFilters.offer },
		{ label: 'Новостник', value: formFilters.news_source },
		{ label: 'Подход', value: selectedApproachName },
	].filter(
		({ label, value }) =>
			typeof value === 'string' && value.trim().length > 0 && !(label === 'Подход' && value.trim() === 'Без подхода'),
	);

	async function handleFileChange(nextFile: File | null) {
		setFile(nextFile);
		const requestId = ++filePreviewRequestRef.current;
		if (!nextFile) {
			setFilePreview({ status: 'idle', content: '' });
			return;
		}

		setTitle(nextFile.name);
		setContent('');
		setFilePreview({ status: 'loading', content: '' });
		const dotIndex = nextFile.name.lastIndexOf('.');
		const extension = dotIndex >= 0 ? nextFile.name.slice(dotIndex).toLowerCase() : '';
		if (!nextFile.type.startsWith('text/') && !TEXT_FILE_EXTENSIONS.has(extension)) {
			setFilePreview({ status: 'error', content: '' });
			return;
		}

		try {
			const extractedContent = await nextFile.text();
			if (requestId !== filePreviewRequestRef.current) return;
			if (extractedContent.trim()) setContent(extractedContent);
			setFilePreview(
				extractedContent.trim() ? { status: 'ready', content: extractedContent } : { status: 'error', content: '' },
			);
		} catch {
			if (requestId === filePreviewRequestRef.current) setFilePreview({ status: 'error', content: '' });
		}
	}

	function clearSelectedFile() {
		void handleFileChange(null);
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	const sourceLabel = file
		? `Добавлено из файла · ${file.name}`
		: mode === 'create'
			? `Добавлено вручную · ${new Date().toLocaleDateString('ru-RU')}`
			: `${
					item?.sourceType === 'rated_content'
						? 'Ответ агента'
						: item?.sourceType === 'assistant_file'
							? 'Файл из диалога'
							: item?.sourceType === 'uploaded_file'
								? 'Файл'
								: 'Добавлено вручную'
				} · ${item ? new Date(item.createdAt).toLocaleDateString('ru-RU') : ''}`;
	const previewFileName = file?.name ?? item?.fileName ?? title;

	const confirmLabel = saving
		? mode === 'create'
			? 'Добавление…'
			: 'Сохранение…'
		: mode === 'create'
			? 'Добавить данные'
			: 'Сохранить изменения';

	return (
		<main className="knowledge-editor-page knowledge-page">
			<header className="knowledge-editor-page__header">
				<button className="knowledge-editor-page__back" type="button" onClick={onCancel}>← База знаний</button>
				<h1 id="knowledge-editor-title">{mode === 'create' ? 'Добавить данные' : 'Редактировать данные'}</h1>
				<p>{mode === 'create' ? 'Заполните материал и его метаданные' : 'Все изменения будут применены после сохранения'}</p>
			</header>
			<div className="knowledge-editor-page__content" role="region" aria-labelledby="knowledge-editor-title">
			<div className="knowledge-edit-modal__tabs" role="tablist" aria-label="Режим редактора">
				<button
					className={activeTab === 'edit' ? 'active' : ''}
					type="button"
					role="tab"
					aria-selected={activeTab === 'edit'}
					onClick={() => setActiveTab('edit')}
				>
					Редактирование
				</button>
				<button
					className={activeTab === 'preview' ? 'active' : ''}
					type="button"
					role="tab"
					aria-selected={activeTab === 'preview'}
					onClick={() => setActiveTab('preview')}
				>
					Предпросмотр
				</button>
			</div>
			<section className="knowledge-editor-page__card">
				{activeTab === 'edit' ? (
					<div className="knowledge-edit-modal__form" role="tabpanel">
						<section className="knowledge-editor-page__section" aria-labelledby="knowledge-data-main-title">
							<h2 id="knowledge-data-main-title">Основные данные</h2>
							<label>
								Название
								<input value={title} onChange={(event) => setTitle(event.target.value)} />
							</label>
							<label>
								Содержимое
								<textarea
									value={content}
									onChange={(event) => setContent(event.target.value)}
									placeholder="Вставьте текст"
								/>
							</label>
							<div className="knowledge-edit-modal__file-field">
								<span>Файл</span>
								<input
									ref={fileInputRef}
									className="knowledge-edit-modal__file-input"
									type="file"
									onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
								/>
								<div className="knowledge-edit-modal__file-picker">
									<DropZone
										className="knowledge-edit-modal__file-drop-zone"
										showOverlay={false}
										onFilesDrop={(files) => void handleFileChange(files[0] ?? null)}
									>
										{(isDragging) => (
											<button
												type="button"
												className={isDragging ? 'is-dragging' : undefined}
												aria-label={isDragging ? 'Отпустите файл' : 'Выбрать файл'}
												onClick={() => fileInputRef.current?.click()}
											>
												<DocumentIcon />
												<span>{isDragging ? 'Отпустите файл' : file?.name ?? 'Перетащите файл сюда или выберите файл'}</span>
											</button>
										)}
									</DropZone>
									{file && (
										<button
											className="knowledge-edit-modal__file-remove"
											type="button"
											onClick={clearSelectedFile}
											aria-label={`Убрать файл ${file.name}`}
										>
											<CrossIcon />
										</button>
									)}
								</div>
							</div>
						</section>
						<div className="knowledge-edit-modal__divider" />
						<section className="knowledge-edit-modal__metadata" aria-labelledby="knowledge-data-metadata-title">
							<h2 id="knowledge-data-metadata-title">Метаданные</h2>
							<div className="knowledge-edit-modal__metadata-grid">
								<KnowledgeFilterFields value={formFilters} onChange={setFormFilters} disabled={saving} />
								<div className="knowledge-edit-modal__approach">
									<label>
										Подход
										<CustomSelect
											value={selectedApproachId}
											onChange={setSelectedApproachId}
											ariaLabel="Подход элемента"
											options={[
												{ value: '', label: 'Без подхода' },
												...approaches
													.filter((approach) => approach.isActive || approach.id === selectedApproachId)
													.map((approach) => ({ value: approach.id, label: approach.name })),
											]}
										/>
									</label>
								</div>
								<div className="knowledge-edit-modal__rating">
									<span>Рейтинг</span>
									<Rating value={rating} onChange={setRating} ariaLabel="Рейтинг элемента" />
								</div>
							</div>
							<Checkbox
								checked={isActive}
								onChange={setIsActive}
								label="Использовать в ответах"
								className="knowledge-edit-modal__switch knowledge-card__active-toggle"
							/>
						</section>
					</div>
				) : (
					<div className="knowledge-edit-modal__preview" role="tabpanel">
						<h3>{title.trim() || file?.name || 'Без названия'}</h3>
						<Rating value={rating} readonly ariaLabel="Рейтинг элемента" />
						<span className="knowledge-edit-modal__preview-source">{sourceLabel}</span>
						<div className="knowledge-edit-modal__preview-markdown">
							{file ? (
								filePreview.status === 'loading' ? (
									<p>Загрузка содержимого файла…</p>
								) : filePreview.status === 'ready' ? (
									<Suspense fallback={<p>Загрузка содержимого файла…</p>}>
										<MarkdownEditor value={content} onChange={() => undefined} readonly fileName={previewFileName} />
									</Suspense>
								) : (
									<p>Не удалось отобразить содержимое файла в предпросмотре</p>
								)
							) : content.trim() ? (
								<Suspense fallback={<p>Загрузка предпросмотра…</p>}>
									<MarkdownEditor value={content} onChange={() => undefined} readonly fileName={previewFileName} />
								</Suspense>
							) : (
								<p>Текстовое содержимое не заполнено</p>
							)}
						</div>
						{previewMetadata.length > 0 && (
							<div className="knowledge-edit-modal__chips">
								{previewMetadata.map(({ label, value }) => (
									<span key={label}>
										{label} · {value?.trim()}
									</span>
								))}
							</div>
						)}
					</div>
				)}
				<div className="knowledge-editor-page__actions">
					<button type="button" disabled={saving} onClick={onCancel}>Отмена</button>
					<button className="knowledge-editor-page__confirm" type="button" disabled={saving} onClick={onConfirm}>{confirmLabel}</button>
				</div>
			</section>
			</div>
		</main>
	);
}

export function KnowledgePage({ user }: { user: AuthUser }) {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const debouncedSearch = useDebounce(params.get('q') ?? '', 250);
	const items = useKnowledgeStore((state) => state.items);
	const setItems = useKnowledgeStore((state) => state.setItems);
	const nextCursor = useKnowledgeStore((state) => state.nextCursor);
	const setNextCursor = useKnowledgeStore((state) => state.setNextCursor);
	const search = useKnowledgeStore((state) => state.search);
	const setSearch = useKnowledgeStore((state) => state.setSearch);
	const sourceType = params.get('source') ?? '';
	const approachId = params.get('approach') ?? '';
	const geo = params.get('geo') ?? '';
	const celebrity = params.get('celebrity') ?? '';
	const offer = params.get('offer') ?? '';
	const newsSource = params.get('news_source') ?? '';
	const activeFilter = params.get('active') ?? 'all';
	const ratingFilter = (params.get('rating') as RatingFilter | null) ?? 'all';
	const sort = (params.get('sort') as SortMode | null) ?? 'date_desc';
	const loading = useKnowledgeStore((state) => state.isLoading);
	const setLoading = useKnowledgeStore((state) => state.setLoading);
	const loadingMore = useKnowledgeStore((state) => state.isLoadingMore);
	const setLoadingMore = useKnowledgeStore((state) => state.setLoadingMore);
	const dialog = useKnowledgeStore((state) => state.dialog);
	const setDialog = useKnowledgeStore((state) => state.setDialog);
	const approaches = useApproachesStore((state) => state.items);
	const loadApproaches = useApproachesStore((state) => state.load);
	const pendingItemIds = useKnowledgeStore((state) => state.pendingItemIds);
	const markPending = useKnowledgeStore((state) => state.markPending);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const { showToast } = useToast();

	const [activeDropdown, setActiveDropdown] = useState<'filters' | 'sort' | null>(null);
	const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	const [bulkDeleting, setBulkDeleting] = useState(false);
	const [cardMenu, setCardMenu] = useState<KnowledgeCardMenuState | null>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const cardMenuRef = useRef<HTMLDivElement>(null);
	const cardCursorIndicatorRef = useRef<HTMLDivElement>(null);
	const cardCursorPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const cardCursorTimerRef = useRef<number | null>(null);
	const selectedItems = useMemo(() => items.filter((item) => selectedItemIds.has(item.id)), [items, selectedItemIds]);
	const cardMenuItem = cardMenu ? items.find((item) => item.id === cardMenu.itemId) : null;

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setActiveDropdown(null);
			}
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setActiveDropdown(null);
		}
		if (activeDropdown) {
			document.addEventListener('mousedown', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
		}
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [activeDropdown]);

	useEffect(() => {
		if (!cardMenu) return;
		function handleClickOutside(event: MouseEvent) {
			if (!cardMenuRef.current?.contains(event.target as Node)) setCardMenu(null);
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setCardMenu(null);
		}
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [cardMenu]);

	useEffect(
		() => () => {
			if (cardCursorTimerRef.current !== null) window.clearTimeout(cardCursorTimerRef.current);
		},
		[],
	);

	useEffect(() => {
		setSearch(params.get('q') ?? '');
		// URL is the source of truth only when the page is entered.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		loadApproaches()
			.catch((error: unknown) => {
				reportError('KNOWLEDGE_APPROACHES_FAILED', error);
				showToast(error instanceof Error ? error.message : 'Не удалось загрузить подходы', 'error');
			});
	}, [loadApproaches, showToast]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		listKnowledge({
			search: debouncedSearch || undefined,
			sourceType: sourceType || undefined,
			approachId: approachId || undefined,
			filters: { geo, celebrity, offer, news_source: newsSource },
			isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
			minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter),
			unrated: ratingFilter === 'unrated',
			sort,
			limit: 20,
		})
			.then((result) => {
				if (!cancelled) {
					setItems(result.items);
					setSelectedItemIds(new Set());
					setNextCursor(result.pageInfo.nextCursor);
				}
			})
			.catch((error: unknown) => {
				reportError('KNOWLEDGE_LIST_FAILED', error);
				if (!cancelled) showToast(error instanceof Error ? error.message : 'Не удалось загрузить базу знаний', 'error');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [
		activeFilter,
		approachId,
		celebrity,
		debouncedSearch,
		geo,
		newsSource,
		offer,
		ratingFilter,
		setItems,
		setLoading,
		setNextCursor,
		showToast,
		sort,
		sourceType,
	]);

	const counts = useMemo(
		() => ({ total: items.length, active: items.filter((item) => item.isActive).length }),
		[items],
	);

	function setFilter(name: string, value: string, defaultValue = '') {
		const next = new URLSearchParams(params);
		if (value && value !== defaultValue) next.set(name, value);
		else next.delete(name);
		setParams(next);
	}
	function handleSearchChange(value: string) {
		setSearch(value);
		const next = new URLSearchParams(params);
		if (value.trim()) next.set('q', value.trim());
		else next.delete('q');
		setParams(next, { replace: true });
	}

	function resetFiltersOnly() {
		const next = new URLSearchParams(params);
		['source', 'approach', 'geo', 'celebrity', 'offer', 'news_source', 'rating', 'active'].forEach((key) =>
			next.delete(key),
		);
		setParams(next);
	}

	const activeFiltersCount = [
		sourceType,
		approachId,
		geo,
		celebrity,
		offer,
		newsSource,
		ratingFilter !== 'all' ? ratingFilter : '',
		activeFilter !== 'all' ? activeFilter : '',
	].filter(Boolean).length;

	async function changeRating(item: KnowledgeItem, value: number | null) {
		if (pendingItemIds.has(item.id)) return;
		const previous = item.rating;
		markPending(item.id, true);
		setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, rating: value } : entry)));
		try {
			const updated = await updateKnowledgeItem(item.id, { rating: value });
			setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
		} catch (error) {
			setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, rating: previous } : entry)));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить рейтинг', 'error');
		} finally {
			markPending(item.id, false);
		}
	}

	async function toggleItem(item: KnowledgeItem, nextActive: boolean) {
		if (pendingItemIds.has(item.id)) return;
		markPending(item.id, true);
		setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, isActive: nextActive } : entry)));
		try {
			const updated = await updateKnowledgeItem(item.id, { isActive: nextActive });
			setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
		} catch (error) {
			setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
			showToast(error instanceof Error ? error.message : 'Не удалось изменить состояние', 'error');
		} finally {
			markPending(item.id, false);
		}
	}

	async function removeItem(item: KnowledgeItem) {
		try {
			await deleteKnowledgeItem(item.id);
			setItems((current) => current.filter((entry) => entry.id !== item.id));
			setSelectedItemIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
			setDialog(null);
			showToast('Элемент перемещён в корзину', 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось удалить элемент', 'error');
		}
	}

	function toggleSelectedItem(itemId: string, selected: boolean) {
		setSelectedItemIds((current) => {
			const next = new Set(current);
			if (selected) next.add(itemId);
			else next.delete(itemId);
			return next;
		});
	}

	function hideCardCursorIndicator() {
		if (cardCursorTimerRef.current !== null) window.clearTimeout(cardCursorTimerRef.current);
		cardCursorTimerRef.current = null;
		cardCursorPositionRef.current = null;
		if (cardCursorIndicatorRef.current) {
			cardCursorIndicatorRef.current.style.transform = 'translate3d(-100px, -100px, 0)';
		}
	}

	function updateCardCursorIndicator(target: EventTarget | null, clientX: number, clientY: number) {
		const indicator = cardCursorIndicatorRef.current;
		const interactiveTarget =
			target instanceof Element &&
			target.closest('button, a, input, label, select, textarea, .knowledge-card__metadata-summary');
		hideCardCursorIndicator();
		if (!indicator || interactiveTarget || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
			return;
		}

		cardCursorPositionRef.current = { clientX, clientY };
		cardCursorTimerRef.current = window.setTimeout(() => {
			cardCursorTimerRef.current = null;
			const position = cardCursorPositionRef.current;
			if (!position || !cardCursorIndicatorRef.current) return;
			const indicatorSize = 16;
			const viewportInset = 6;
			const x = Math.max(
				viewportInset,
				Math.min(position.clientX + 10, window.innerWidth - indicatorSize - viewportInset),
			);
			const y = Math.max(
				viewportInset,
				Math.min(position.clientY + 10, window.innerHeight - indicatorSize - viewportInset),
			);
			cardCursorIndicatorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		}, 400);
	}

	function openCardMenu(itemId: string, left: number, top: number) {
		setCardMenu({
			itemId,
			left: Math.max(8, Math.min(left, window.innerWidth - 228)),
			top: Math.max(8, Math.min(top, window.innerHeight - 248)),
		});
	}

	function runCardMenuAction(action: () => void) {
		setCardMenu(null);
		action();
	}

	async function removeSelectedItems() {
		if (selectedItems.length === 0 || bulkDeleting) return;
		setBulkDeleting(true);
		const results = await Promise.allSettled(selectedItems.map((item) => deleteKnowledgeItem(item.id)));
		const deletedIds = new Set<string>();
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') deletedIds.add(selectedItems[index].id);
		});
		if (deletedIds.size > 0) {
			setItems((current) => current.filter((item) => !deletedIds.has(item.id)));
			setSelectedItemIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
		}
		const failedCount = results.length - deletedIds.size;
		showToast(
			failedCount > 0
				? `Перемещено в корзину: ${deletedIds.size}. Не удалось удалить: ${failedCount}`
				: `Перемещено в корзину элементов: ${deletedIds.size}`,
			failedCount > 0 ? 'error' : 'success',
		);
		setBulkDeleting(false);
		setBulkDeleteOpen(false);
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const result = await listKnowledge({
				search: params.get('q') || undefined,
				sourceType: sourceType || undefined,
				approachId: approachId || undefined,
				filters: { geo, celebrity, offer, news_source: newsSource },
				isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
				minRating: ratingFilter === 'all' || ratingFilter === 'unrated' ? undefined : Number(ratingFilter),
				unrated: ratingFilter === 'unrated',
				sort,
				limit: 20,
				cursor: nextCursor,
			});
			setItems((current) => [...current, ...result.items]);
			setNextCursor(result.pageInfo.nextCursor);
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Не удалось загрузить следующую страницу', 'error');
		} finally {
			setLoadingMore(false);
		}
	}
	return (
		<div className="knowledge-shell">
			<main className="knowledge-page">
				<header>
					<div>
						<button className="knowledge-page__mobile-menu" type="button" onClick={() => setSidebarOpen(true)}>
							☰
						</button>
						<h1>База знаний</h1>
						<p>
							{user.email} · на странице активно {counts.active} из {counts.total}
						</p>
					</div>
					<div className="knowledge-page__header-actions">
						<button type="button" onClick={() => navigate('/knowledge/approaches')}>Подходы</button>
						<button className="knowledge-page__add" type="button" onClick={() => navigate('/knowledge/new')}>
							Добавить данные
						</button>
					</div>
				</header>
				<section className="knowledge-page__controls" aria-label="Управление базой знаний" ref={dropdownRef}>
					<div className="knowledge-page__search-row">
						<div className="knowledge-page__search">
							<SearchIcon className="knowledge-page__search-icon" />

							<input
								className="knowledge-page__search-input"
								value={search}
								onChange={(event) => handleSearchChange(event.target.value)}
								placeholder="Поиск по названию, содержимому и имени файла"
								aria-label="Поиск по базе знаний"
							/>
						</div>

						<button
							className={`knowledge-page__control-btn ${activeDropdown === 'filters' ? 'active' : ''}`}
							type="button"
							aria-expanded={activeDropdown === 'filters'}
							onClick={() => setActiveDropdown(activeDropdown === 'filters' ? null : 'filters')}
						>
							Фильтры {activeFiltersCount > 0 && <span>{activeFiltersCount}</span>}
						</button>

						<button
							className={`knowledge-page__control-btn ${activeDropdown === 'sort' ? 'active' : ''}`}
							type="button"
							aria-expanded={activeDropdown === 'sort'}
							onClick={() => setActiveDropdown(activeDropdown === 'sort' ? null : 'sort')}
						>
							Сортировка
						</button>
					</div>

					{activeDropdown === 'filters' && (
						<div className="knowledge-page__dropdown knowledge-page__dropdown--filters">
							<div className="knowledge-page__dropdown-grid">
								<label>
									Источник
									<CustomSelect
										value={sourceType}
										onChange={(value) => setFilter('source', value)}
										ariaLabel="Источник"
										options={[
											{ value: '', label: 'Все источники' },
											{ value: 'manual', label: 'Вручную' },
											{ value: 'uploaded_file', label: 'Файлы' },
											{ value: 'rated_content', label: 'Оценённые ответы' },
										]}
									/>
								</label>
								<label>
									Подход
									<CustomSelect
										value={approachId}
										onChange={(value) => setFilter('approach', value)}
										ariaLabel="Подход"
										options={[
											{ value: '', label: 'Все подходы' },
											...approaches.map((approach) => ({ value: approach.id, label: approach.name })),
										]}
									/>
								</label>
								<label>
									Рейтинг
									<CustomSelect
										value={ratingFilter}
										onChange={(value) => setFilter('rating', value, 'all')}
										ariaLabel="Рейтинг"
										options={[
											{ value: 'all', label: 'Все рейтинги' },
											{ value: '5', label: '5 из 5' },
											{ value: '4', label: '4 и выше' },
											{ value: '3', label: '3 и выше' },
											{ value: 'unrated', label: 'Без рейтинга' },
										]}
									/>
								</label>
								<label>
									Использование
									<CustomSelect
										value={activeFilter}
										onChange={(value) => setFilter('active', value, 'all')}
										ariaLabel="Использование"
										options={[
											{ value: 'all', label: 'Все состояния' },
											{ value: 'active', label: 'Используются агентом' },
											{ value: 'inactive', label: 'Отключены' },
										]}
									/>
								</label>
								<label>
									ГЕО
									<input value={geo} onChange={(event) => setFilter('geo', event.target.value)} placeholder="ГЕО" />
								</label>
								<label>
									Селеба
									<input
										value={celebrity}
										onChange={(event) => setFilter('celebrity', event.target.value)}
										placeholder="Селеба"
									/>
								</label>
								<label>
									Оффер
									<input
										value={offer}
										onChange={(event) => setFilter('offer', event.target.value)}
										placeholder="Оффер"
									/>
								</label>
								<label>
									Новостник
									<input
										value={newsSource}
										onChange={(event) => setFilter('news_source', event.target.value)}
										placeholder="Новостник"
									/>
								</label>
							</div>
							<div className="knowledge-page__dropdown-actions">
								<button
									className="knowledge-page__reset-small"
									type="button"
									disabled={activeFiltersCount === 0}
									onClick={resetFiltersOnly}
								>
									Сбросить
								</button>
							</div>
						</div>
					)}

					{activeDropdown === 'sort' && (
						<div className="knowledge-page__dropdown knowledge-page__dropdown--sort">
							{[
								{ label: 'Сначала новые', value: 'date_desc' },
								{ label: 'Сначала старые', value: 'date_asc' },
								{ label: 'Рейтинг: высокий', value: 'rating_desc' },
								{ label: 'Рейтинг: низкий', value: 'rating_asc' },
							].map((item) => (
								<button
									key={item.value}
									className={`knowledge-page__sort-option ${sort === item.value ? 'active' : ''}`}
									type="button"
									onClick={() => {
										setFilter('sort', item.value, 'date_desc');
										setActiveDropdown(null);
									}}
								>
									{item.label}
								</button>
							))}
						</div>
					)}
				</section>
				<div className="knowledge-page__bulk-slot">
					{selectedItems.length > 0 && (
						<div className="knowledge-page__bulk-bar" role="region" aria-label="Действия с выбранными элементами">
							<strong>Выбрано: {selectedItems.length}</strong>
							<button
								type="button"
								disabled={selectedItems.length === items.length}
								onClick={() => setSelectedItemIds(new Set(items.map((item) => item.id)))}
							>
								Выбрать все {items.length}
							</button>
							<button type="button" onClick={() => setSelectedItemIds(new Set())}>
								Снять выбор
							</button>
							<button className="knowledge-page__bulk-delete" type="button" onClick={() => setBulkDeleteOpen(true)}>
								<TrashIcon />
								В корзину {selectedItems.length}
							</button>
						</div>
					)}
				</div>
				<section className="knowledge-page__list">
					{loading && <p className="knowledge-page__empty">Загрузка…</p>}
					{!loading && items.length === 0 && <p className="knowledge-page__empty">Сохранённых данных пока нет</p>}
					{!loading &&
						items.map((item) => (
							<article
								className={`knowledge-card ${selectedItemIds.has(item.id) ? 'knowledge-card--selected' : ''}`}
								key={item.id}
								onMouseEnter={(event) => updateCardCursorIndicator(event.target, event.clientX, event.clientY)}
								onMouseMove={(event) => updateCardCursorIndicator(event.target, event.clientX, event.clientY)}
								onMouseLeave={hideCardCursorIndicator}
								onContextMenu={(event) => {
									hideCardCursorIndicator();
									if ((event.target as HTMLElement).closest('button, a, input, label')) return;
									event.preventDefault();
									openCardMenu(item.id, event.clientX, event.clientY);
								}}
								onClick={(event) => {
									if (!(event.target as HTMLElement).closest('button, a, input, label')) navigate(`/knowledge/${item.id}`);
								}}
							>
								<div className="knowledge-card__select-column">
									<Checkbox
										checked={selectedItemIds.has(item.id)}
										onChange={(checked) => toggleSelectedItem(item.id, checked)}
										label={`Выбрать ${item.title}`}
										className="knowledge-card__select"
									/>
								</div>
								<div className="knowledge-card__content">
									<div className="knowledge-card__head">
										<div>
											<strong>{`${item.title}`}</strong>
											<Rating value={item.rating} readonly size="small" ariaLabel={`Рейтинг ${item.title}`} />
											<KnowledgeCardMetadata
												source={knowledgeSourceLabel(item.sourceType)}
												createdAt={item.createdAt}
												updatedAt={item.updatedAt}
											/>
											{item.approach && <span className="knowledge-card__approach">Подход: {item.approach.name}</span>}
											<div className="knowledge-card__metadata">
												{Object.entries(storedFilters(item))
													.filter((entry): entry is [string, string] => Boolean(entry[1]))
													.map(([key, value]) => (
														<span key={key}>
															{
																(
																	{
																		geo: 'ГЕО',
																		celebrity: 'Селеба',
																		offer: 'Оффер',
																		news_source: 'Новостник',
																	} as Record<string, string>
																)[key]
															}
															: {value}
														</span>
													))}
											</div>
											{extractionStatusLabel(item) && (
												<span className="knowledge-card__extraction-warning">{extractionStatusLabel(item)}</span>
											)}
										</div>
										<Checkbox
											checked={item.isActive}
											disabled={pendingItemIds.has(item.id)}
											onChange={(checked) => void toggleItem(item, checked)}
											label="Использовать в ответах"
											className="knowledge-card__active-toggle"
										/>
									</div>
									<p>{item.content || 'Текстовое содержимое не извлечено'}</p>
								</div>
							</article>
						))}
					{!loading && nextCursor && (
						<button
							className="knowledge-page__more"
							type="button"
							disabled={loadingMore}
							onClick={() => void loadMore()}
						>
							{loadingMore ? 'Загрузка…' : 'Показать ещё'}
						</button>
					)}
				</section>
				{createPortal(
					<div ref={cardCursorIndicatorRef} className="knowledge-card__cursor-indicator" aria-hidden="true">
						<ListIcon />
					</div>,
					document.body,
				)}
				{cardMenu && cardMenuItem && (
					<div
						ref={cardMenuRef}
						className="knowledge-card__menu"
						role="menu"
						aria-label={`Действия с записью «${cardMenuItem.title}»`}
						style={{ top: cardMenu.top, left: cardMenu.left }}
					>
						<button type="button" role="menuitem" onClick={() => runCardMenuAction(() => navigate(`/knowledge/${cardMenuItem.id}`))}>
							Редактировать
						</button>
						{cardMenuItem.downloadUrl && (
							<a
								href={cardMenuItem.downloadUrl}
								download={cardMenuItem.fileName}
								role="menuitem"
								onClick={() => setCardMenu(null)}
							>
								Скачать файл
							</a>
						)}
						{cardMenuItem.originalDownloadUrl && (
							<a
								href={cardMenuItem.originalDownloadUrl}
								download={cardMenuItem.originalFilename ?? undefined}
								role="menuitem"
								onClick={() => setCardMenu(null)}
							>
								Скачать оригинал
							</a>
						)}
						<button
							type="button"
							role="menuitem"
							onClick={() => runCardMenuAction(() => void changeRating(cardMenuItem, null))}
						>
							Убрать рейтинг
						</button>
						<div className="knowledge-card__menu-separator" role="separator" />
						<button
							className="knowledge-card__menu-delete"
							type="button"
							role="menuitem"
							onClick={() => runCardMenuAction(() => setDialog({ type: 'delete', item: cardMenuItem }))}
						>
							Переместить в корзину
						</button>
					</div>
				)}

				{dialog?.type === 'delete' && (
					<ModalDialog
						title="Переместить элемент в корзину?"
						confirmLabel="Переместить в корзину"
						danger
						onClose={() => setDialog(null)}
						onConfirm={() => void removeItem(dialog.item)}
					>
						<p>«{dialog.item.title}» будет перемещён в корзину</p>
					</ModalDialog>
				)}
				{bulkDeleteOpen && (
					<ModalDialog
						title="Переместить выбранные элементы в корзину?"
						confirmLabel={bulkDeleting ? 'Удаление…' : `Переместить в корзину`}
						confirmDisabled={bulkDeleting}
						danger
						onClose={() => setBulkDeleteOpen(false)}
						onConfirm={() => void removeSelectedItems()}
					>
						<p>Выбранные элементы будут перемещены в корзину: {selectedItems.length}</p>
					</ModalDialog>
				)}
			</main>
		</div>
	);
}

export default KnowledgePage;
