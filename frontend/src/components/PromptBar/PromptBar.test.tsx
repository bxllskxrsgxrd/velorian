import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { USER_MESSAGE_INLINE_CHAR_LIMIT } from '../../constants/limits';
import { PromptBar } from './PromptBar';
import { promptMarker } from '../../constants/promptTools';

const WEB_SEARCH_MARKER = promptMarker('web');

function renderPromptBar(onSendMessage = vi.fn().mockResolvedValue(undefined), onFilesSelect = vi.fn()) {
	render(
		<PromptBar
			files={[]}
			isGenerating={false}
			onSendMessage={onSendMessage}
			onStop={vi.fn()}
			onRemoveFile={vi.fn()}
			onOpenFile={vi.fn()}
			onFilesSelect={onFilesSelect}
			onClearFiles={vi.fn()}
		/>,
	);
	return { onSendMessage, onFilesSelect };
}

function enableWebSearch() {
	fireEvent.click(screen.getByLabelText('Открыть меню действий'));
	fireEvent.click(screen.getByRole('menuitemradio', { name: 'Поиск в сети' }));
}

describe('PromptBar web search', () => {
	it('moves the textarea into the multiline layout when the prompt wraps to multiple lines', async () => {
		renderPromptBar();
		const textarea = screen.getByRole('textbox');

		fireEvent.change(textarea, { target: { value: 'первая строка\nвторая строка' } });

		await waitFor(() => expect(textarea.closest('form')).toHaveClass('prompt-bar--multiline'));
	});

	it('keeps search after deleting the separator and disables it when the marker is edited', () => {
		renderPromptBar();
		enableWebSearch();
		const textarea = screen.getByRole('textbox');
		expect(textarea).toHaveValue(WEB_SEARCH_MARKER);

		const markerWithoutSpace = WEB_SEARCH_MARKER.trimEnd();
		fireEvent.change(textarea, { target: { value: markerWithoutSpace } });
		fireEvent.click(screen.getByLabelText('Открыть меню действий'));
		expect(screen.getByRole('menuitemradio', { name: 'Отключить поиск в сети' })).toHaveAttribute('aria-checked', 'true');
		fireEvent.click(screen.getByRole('menuitemradio', { name: 'Отключить поиск в сети' }));
		enableWebSearch();

		fireEvent.change(textarea, { target: { value: markerWithoutSpace.slice(0, -1) } });
		expect(textarea).toHaveValue('');

		fireEvent.click(screen.getByLabelText('Открыть меню действий'));
		expect(screen.getByRole('menuitemradio', { name: 'Поиск в сети' })).toHaveAttribute('aria-checked', 'false');
	});

	it('removes the marker before sending the web-search request', async () => {
		const { onSendMessage } = renderPromptBar();
		enableWebSearch();
		fireEvent.change(screen.getByRole('textbox'), { target: { value: `${WEB_SEARCH_MARKER}курс рубля` } });
		fireEvent.click(screen.getByLabelText('Отправить сообщение'));

		await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('курс рубля', [], 'web'));
	});

	it('enables knowledge search as an exclusive mode and submits it explicitly', async () => {
		const { onSendMessage } = renderPromptBar();
		fireEvent.click(screen.getByLabelText('Открыть меню действий'));
		fireEvent.click(screen.getByRole('menuitemradio', { name: 'Поиск по базе знаний' }));
		fireEvent.change(screen.getByRole('textbox'), { target: { value: `${promptMarker('knowledge')}мой оффер` } });
		fireEvent.click(screen.getByLabelText('Отправить сообщение'));
		await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('мой оффер', [], 'knowledge'));
	});

	it('turns a large Unicode paste into a text attachment without duplicating it', () => {
		const onFilesSelect = vi.fn();
		renderPromptBar(undefined, onFilesSelect);
		const largeText = `Привет\n${'данные '.repeat(USER_MESSAGE_INLINE_CHAR_LIMIT)}`;
		const textarea = screen.getByRole('textbox');
		fireEvent.paste(textarea, { clipboardData: { getData: () => largeText } });

		expect(textarea).toHaveValue('');
		expect(onFilesSelect).toHaveBeenCalledOnce();
		const file = onFilesSelect.mock.calls[0][0][0] as File;
		expect(file.name).toMatch(/^pasted-text-.*\.txt$/);
		expect(file.type).toContain('text/plain');
	});
});
