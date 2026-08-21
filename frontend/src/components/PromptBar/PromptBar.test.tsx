import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptBar, WEB_SEARCH_MARKER } from './PromptBar';

function renderPromptBar(onSendMessage = vi.fn().mockResolvedValue(undefined)) {
	render(
		<PromptBar
			files={[]}
			isGenerating={false}
			onSendMessage={onSendMessage}
			onStop={vi.fn()}
			onRemoveFile={vi.fn()}
			onOpenFile={vi.fn()}
			onFilesSelect={vi.fn()}
			onClearFiles={vi.fn()}
		/>,
	);
	return onSendMessage;
}

function enableWebSearch() {
	fireEvent.click(screen.getByLabelText('Открыть меню действий'));
	fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Поиск в сети' }));
}

describe('PromptBar web search', () => {
	it('keeps search after deleting the separator and disables it when the marker is edited', () => {
		renderPromptBar();
		enableWebSearch();
		const textarea = screen.getByRole('textbox');
		expect(textarea).toHaveValue(WEB_SEARCH_MARKER);

		const markerWithoutSpace = WEB_SEARCH_MARKER.trimEnd();
		fireEvent.change(textarea, { target: { value: markerWithoutSpace } });
		fireEvent.click(screen.getByLabelText('Открыть меню действий'));
		expect(screen.getByRole('menuitemcheckbox', { name: 'Отключить поиск в сети' })).toHaveAttribute('aria-checked', 'true');
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Отключить поиск в сети' }));
		enableWebSearch();

		fireEvent.change(textarea, { target: { value: markerWithoutSpace.slice(0, -1) } });
		expect(textarea).toHaveValue('');

		fireEvent.click(screen.getByLabelText('Открыть меню действий'));
		expect(screen.getByRole('menuitemcheckbox', { name: 'Поиск в сети' })).toHaveAttribute('aria-checked', 'false');
	});

	it('removes the marker before sending the web-search request', async () => {
		const onSendMessage = renderPromptBar();
		enableWebSearch();
		fireEvent.change(screen.getByRole('textbox'), { target: { value: `${WEB_SEARCH_MARKER}курс рубля` } });
		fireEvent.click(screen.getByLabelText('Отправить сообщение'));

		await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('курс рубля', [], true));
	});
});
