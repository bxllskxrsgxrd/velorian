import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessageContent } from './AssistantMessageContent';

const writeText = vi.fn().mockResolvedValue(undefined);

describe('AssistantMessageContent', () => {
	beforeEach(() => {
		writeText.mockClear();
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
	});

	it('shows the fenced-code language and copies only the code', async () => {
		render(<AssistantMessageContent content={'```html\n<div>Velorian</div>\n```'} isStreaming={false} />);

		expect(screen.getByText('HTML')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Копировать HTML' }));

		await waitFor(() => expect(writeText).toHaveBeenCalledWith('<div>Velorian</div>'));
	});

	it('renders a copy control for a Markdown table and copies it as TSV', async () => {
		render(
			<AssistantMessageContent
				content={'| Формат | Статус |\n| --- | --- |\n| HTML | Готово |'}
				isStreaming={false}
			/>,
		);

		expect(screen.getByText('Таблица')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Копировать таблицу' }));

		await waitFor(() => expect(writeText).toHaveBeenCalledWith('Формат\tСтатус\nHTML\tГотово'));
	});
});
