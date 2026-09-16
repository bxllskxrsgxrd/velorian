import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useApproachesStore } from '../stores/approachesStore';
import { useUiStore } from '../stores/uiStore';
import { reportError } from '../utils/reportError';
import './_approaches.scss';

export function ApproachesPage() {
	const navigate = useNavigate();
	const items = useApproachesStore((state) => state.items);
	const loading = useApproachesStore((state) => state.isLoading);
	const load = useApproachesStore((state) => state.load);
	const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
	const { showToast } = useToast();

	useEffect(() => {
		void load().catch((error: unknown) => {
			reportError('APPROACHES_LOAD_FAILED', error);
			showToast(error instanceof Error ? error.message : 'Не удалось загрузить подходы', 'error');
		});
	}, [load, showToast]);

	return (
		<main className="approaches-page knowledge-page">
			<header>
				<div>
					<button className="knowledge-page__mobile-menu" type="button" onClick={() => setSidebarOpen(true)}>☰</button>
					<button className="approaches-page__back" type="button" onClick={() => navigate('/knowledge')}>← База знаний</button>
					<h1>Подходы</h1>
					<p>Глобальные профили, которыми руководствуется агент</p>
				</div>
				<button className="knowledge-page__add" type="button" onClick={() => navigate('/knowledge/approaches/new')}>Создать подход</button>
			</header>
			<section className="approaches-page__list">
				{loading && <p>Загрузка…</p>}
				{!loading && items.length === 0 && <p>Подходов пока нет</p>}
				{items.map((item) => (
					<button className="approach-card" type="button" key={item.id} onClick={() => navigate(`/knowledge/approaches/${item.id}`)}>
						<span className="approach-card__head">
							<strong>{item.name}</strong>
							<small className={item.isActive ? 'is-active' : ''}>{item.isActive ? 'Активен' : 'Неактивен'}</small>
						</span>
						<span>{item.description || 'Описание не заполнено'}</span>
						<small>Связанных материалов: {item.linkedKnowledgeItemsCount ?? 0}</small>
					</button>
				))}
			</section>
		</main>
	);
}
