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
		const { container } = render(<AssistantMessageContent content={'```html\n<div>Velorian</div>\n```'} isStreaming={false} />);

		expect(screen.getByText('HTML')).toBeInTheDocument();
		const copyButton = screen.getByRole('button', { name: 'Копировать HTML' });
		expect(copyButton.querySelectorAll('path')).toHaveLength(2);
		fireEvent.click(copyButton);

		await waitFor(() => expect(writeText).toHaveBeenCalledWith('<div>Velorian</div>'));
		expect(screen.getByRole('button', { name: 'Скопировано' }).querySelectorAll('path')).toHaveLength(1);
		expect(container.querySelector('.token.tag')).toBeInTheDocument();
	});

	it('normalizes numbered headings and removes heading emoji', () => {
		render(<AssistantMessageContent content={'## 1️⃣ 🚀 Настройка\n\nТекст'} isStreaming={false} />);

		expect(screen.getByRole('heading', { name: '1. Настройка' })).toBeInTheDocument();
		expect(screen.queryByText(/##|🚀|1️⃣/)).not.toBeInTheDocument();
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
