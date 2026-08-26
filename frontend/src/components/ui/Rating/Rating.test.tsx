import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Rating } from './Rating';

function counts(container: HTMLElement) {
	return {
		active: container.querySelectorAll('.rating__star--active').length,
		inactive: container.querySelectorAll('.rating__star--inactive').length,
	};
}

describe('Rating', () => {
	it.each([
		[1, 1, 4],
		[3, 3, 2],
		[5, 5, 0],
		[null, 0, 5],
	] as const)('renders %s as distinct active and inactive SVG stars', (value, active, inactive) => {
		const { container } = render(<Rating value={value} readonly />);
		expect(counts(container)).toEqual({ active, inactive });
		expect(container.querySelectorAll('svg')).toHaveLength(5);
	});

	it('previews hover and restores the saved value on leave', () => {
		const { container } = render(<Rating value={2} onChange={vi.fn()} />);
		fireEvent.mouseEnter(screen.getByRole('button', { name: 'Поставить рейтинг 4 из 5' }));
		expect(counts(container).active).toBe(4);
		fireEvent.mouseLeave(container.querySelector('.rating')!);
		expect(counts(container).active).toBe(2);
	});

	it('changes by click and keyboard', () => {
		const onChange = vi.fn();
		render(<Rating value={2} onChange={onChange} />);
		const fourth = screen.getByRole('button', { name: 'Поставить рейтинг 4 из 5' });
		fireEvent.click(fourth);
		expect(onChange).toHaveBeenCalledWith(4);
		fireEvent.keyDown(fourth, { key: 'ArrowRight' });
		expect(onChange).toHaveBeenCalledWith(5);
		fireEvent.keyDown(fourth, { key: 'Delete' });
		expect(onChange).toHaveBeenCalledWith(null);
	});
});
