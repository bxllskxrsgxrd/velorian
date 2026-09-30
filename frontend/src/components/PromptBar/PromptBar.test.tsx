import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_MESSAGE_INLINE_CHAR_LIMIT } from '../../constants/limits';
import { PromptBar } from './PromptBar';
import { promptMarker } from '../../constants/promptTools';
import { usePromptStore } from '../../stores/promptStore';
import { useFilesStore } from '../../stores/filesStore';
import { useChatStore } from '../../stores/chatStore';

const WEB_SEARCH_MARKER = promptMarker('web');

function renderPromptBar(onSendMessage = vi.fn().mockResolvedValue(undefined)) {
	render(
		<PromptBar
			onSendMessage={onSendMessage}
			onExport={vi.fn()}
			onStop={vi.fn()}
			onOpenFile={vi.fn()}
		/>,
	);
	return { onSendMessage };
}

function enableWebSearch() {
	fireEvent.click(screen.getByLabelText('Открыть меню действий'));
	fireEvent.click(screen.getByRole('menuitemradio', { name: 'Поиск в сети' }));
}

describe('PromptBar web search', () => {
	beforeEach(() => {
		usePromptStore.getState().reset();
		useFilesStore.getState().reset();
		useChatStore.getState().resetConversation();
	});

	it('moves the textarea into the multiline layout when the prompt wraps to multiple lines', async () => {
		renderPromptBar();
		const textarea = screen.getByRole('textbox');

		fireEvent.change(textarea, { target: { value: 'первая строка\nвторая строка' } });

		await waitFor(() => expect(textarea.closest('form')).toHaveClass('prompt-bar--multiline'));
	});

	it('focuses the textarea from free prompt-bar space without intercepting action buttons', () => {
		renderPromptBar();
		const textarea = screen.getByRole('textbox');
		const form = textarea.closest('form');
		if (!form) throw new Error('Prompt form is missing');
		const inputContainer = form.querySelector('.prompt-bar__input-container');
		if (!inputContainer) throw new Error('Prompt input container is missing');

		fireEvent.click(inputContainer);
		expect(textarea).toHaveFocus();
		textarea.blur();
		fireEvent.click(form);
		expect(textarea).toHaveFocus();

		const actionsButton = screen.getByLabelText('Открыть меню действий');
		actionsButton.focus();
		fireEvent.click(actionsButton);
		expect(actionsButton).toHaveFocus();
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
		renderPromptBar();
		const largeText = `Привет\n${'данные '.repeat(USER_MESSAGE_INLINE_CHAR_LIMIT)}`;
		const textarea = screen.getByRole('textbox');
		fireEvent.paste(textarea, { clipboardData: { getData: () => largeText } });

		expect(textarea).toHaveValue('');
		const [file] = useFilesStore.getState().files;
		expect(file.name).toMatch(/^pasted-text-.*\.txt$/);
		expect(file.type).toContain('text/plain');
	});
});
