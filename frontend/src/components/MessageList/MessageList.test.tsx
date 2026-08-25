import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from './MessageList';

describe('MessageList branches', () => {
	it('shows the active edited request and switches to the previous version', async () => {
		const onActivateBranch = vi.fn();
		render(
			<MessageList
				messages={[
					{ id: 'u1', role: 'user', content: 'Исходный запрос', branchGroupId: 'u1', isActive: false },
					{ id: 'a1', role: 'assistant', content: 'Старый ответ', replyToId: 'u1' },
					{ id: 'u2', role: 'user', content: 'Изменённый запрос', branchGroupId: 'u1', isActive: true },
					{ id: 'a2', role: 'assistant', content: 'Новый ответ', replyToId: 'u2' },
				]}
				onOpenAttachment={vi.fn()}
				onRetry={vi.fn()}
				onEdit={vi.fn()}
				onActivateBranch={onActivateBranch}
				onRate={vi.fn()}
				onRemoveRating={vi.fn()}
				onSaveToKnowledge={vi.fn()}
			/>,
		);

		expect(screen.getByText('Изменённый запрос')).toBeInTheDocument();
		expect(await screen.findByText('Новый ответ')).toBeInTheDocument();
		expect(screen.queryByText('Старый ответ')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Предыдущая версия' }));
		expect(onActivateBranch).toHaveBeenCalledWith('u1');
	});
});
