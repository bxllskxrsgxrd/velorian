import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../components/Toast/ToastProvider';
import { useApproachesStore } from '../stores/approachesStore';
import type { Approach } from '../types/chat';
import { ApproachesPage } from './ApproachesPage';

const api = vi.hoisted(() => ({
	listApproaches: vi.fn(),
	updateApproach: vi.fn(),
	deleteApproach: vi.fn(),
}));

vi.mock('../api/chatApi', () => api);

const approaches: Approach[] = [
	{
		id: 'approach-1',
		name: 'Интервью',
		description: 'Очень длинное описание подхода, которое карточка визуально ограничивает двумя строками.',
		purpose: '',
		characteristics: [],
		structure: [],
		writingGuidelines: [],
		avoid: [],
		exampleKnowledgeItemIds: [],
		rating: null,
		isActive: true,
		linkedKnowledgeItemsCount: 3,
		createdAt: '2026-09-20T08:00:00.000Z',
		updatedAt: '2026-09-20T08:00:00.000Z',
	},
	{
		id: 'approach-2',
		name: 'Шоу',
		description: 'Яркая подача',
		purpose: '',
		characteristics: [],
		structure: [],
		writingGuidelines: [],
		avoid: [],
		exampleKnowledgeItemIds: [],
		rating: 5,
		isActive: false,
		linkedKnowledgeItemsCount: 1,
		createdAt: '2026-09-19T08:00:00.000Z',
		updatedAt: '2026-09-21T08:00:00.000Z',
	},
];

function renderPage() {
	const router = createMemoryRouter(
		[
			{
				path: '/knowledge/approaches',
				element: (
					<ToastProvider>
						<ApproachesPage />
					</ToastProvider>
				),
			},
		],
		{ initialEntries: ['/knowledge/approaches'] },
	);
	return render(<RouterProvider router={router} />);
}

describe('ApproachesPage', () => {
	beforeEach(() => {
		useApproachesStore.getState().reset();
		vi.clearAllMocks();
		api.listApproaches.mockResolvedValue(approaches);
		api.updateApproach.mockImplementation(async (id: string, patch: Partial<Approach>) => ({
			...approaches.find((item) => item.id === id)!,
			...patch,
			updatedAt: '2026-09-28T08:00:00.000Z',
		}));
		api.deleteApproach.mockResolvedValue(undefined);
	});

	it('renders the knowledge-card pattern and saves a user rating independently', async () => {
		renderPage();

		const interviewTitle = await screen.findByText('Интервью', { selector: 'strong' });
		const interviewCard = interviewTitle.closest('article') as HTMLElement;
		const showCard = screen.getByText('Шоу', { selector: 'strong' }).closest('article') as HTMLElement;

		expect(interviewCard).toHaveClass('knowledge-card', 'approach-card');
		expect(interviewCard.querySelector(':scope > .knowledge-card__select-column')).toBeInTheDocument();
		expect(interviewCard).toHaveTextContent('Связанных материалов: 3');
		expect(showCard).toHaveClass('knowledge-card--inactive');
		expect(showCard.querySelector('.knowledge-card__metadata-summary')).toHaveTextContent('Изменено 21.09.2026');

		fireEvent.click(within(interviewCard).getByRole('button', { name: 'Поставить рейтинг 4 из 5' }));

		await waitFor(() => expect(api.updateApproach).toHaveBeenCalledWith('approach-1', { rating: 4 }));
		expect(api.updateApproach.mock.calls[0][1]).not.toHaveProperty('isActive');
		expect(within(interviewCard).getByRole('button', { name: 'Поставить рейтинг 4 из 5' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	it('uses the shared controls, card selection, and stable bulk slot', async () => {
		const { container } = renderPage();
		await screen.findByText('Интервью', { selector: 'strong' });

		const controls = screen.getByRole('region', { name: 'Управление подходами' });
		const bulkSlot = container.querySelector('.knowledge-page__bulk-slot') as HTMLElement;
		const list = container.querySelector('.knowledge-page__list') as HTMLElement;
		expect(controls.compareDocumentPosition(bulkSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(bulkSlot.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Действия с выбранными подходами' })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать Интервью' }));

		const interviewCard = screen.getByText('Интервью', { selector: 'strong' }).closest('article') as HTMLElement;
		const bulkBar = screen.getByRole('region', { name: 'Действия с выбранными подходами' });
		expect(interviewCard).toHaveClass('knowledge-card--selected');
		expect(within(bulkBar).getByText('Выбрано: 1')).toBeInTheDocument();
		expect(within(bulkBar).getByRole('button', { name: 'Выбрать все 2' })).toBeEnabled();

		fireEvent.click(within(bulkBar).getByRole('button', { name: 'Выбрать все 2' }));
		expect(screen.getByRole('checkbox', { name: 'Выбрать Интервью' })).toBeChecked();
		expect(screen.getByRole('checkbox', { name: 'Выбрать Шоу' })).toBeChecked();
		expect(within(bulkBar).getByRole('button', { name: 'Выбрать все 2' })).toBeDisabled();

		fireEvent.click(within(bulkBar).getByRole('button', { name: 'Снять выбор' }));
		expect(screen.queryByRole('region', { name: 'Действия с выбранными подходами' })).not.toBeInTheDocument();
		expect(bulkSlot).toBeInTheDocument();
	});

	it('bulk deletes selected approaches after confirmation', async () => {
		renderPage();
		await screen.findByText('Интервью', { selector: 'strong' });

		fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать Интервью' }));
		fireEvent.click(screen.getByRole('button', { name: 'Удалить 1' }));
		fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

		await waitFor(() => expect(api.deleteApproach).toHaveBeenCalledWith('approach-1'));
		await waitFor(() => {
			expect(screen.queryByRole('region', { name: 'Действия с выбранными подходами' })).not.toBeInTheDocument();
		});
	});

	it('sorts rated approaches and keeps unrated approaches last', async () => {
		renderPage();
		await screen.findByText('Интервью', { selector: 'strong' });

		fireEvent.click(screen.getByRole('button', { name: 'Сортировка' }));
		fireEvent.click(screen.getByRole('button', { name: 'Рейтинг: высокий' }));

		const titles = screen.getAllByRole('article').map((card) => card.querySelector('strong')?.textContent);
		expect(titles).toEqual(['Шоу', 'Интервью']);
	});

	it('replaces name sorting with the shared activity sorting options', async () => {
		renderPage();
		await screen.findByText('Интервью', { selector: 'strong' });

		fireEvent.click(screen.getByRole('button', { name: 'Сортировка' }));
		expect(screen.queryByRole('button', { name: 'По названию' })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Сначала неактивные' }));

		const titles = screen.getAllByRole('article').map((card) => card.querySelector('strong')?.textContent);
		expect(titles).toEqual(['Шоу', 'Интервью']);
	});
});
