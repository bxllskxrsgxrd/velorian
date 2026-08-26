import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
	it('renders unchecked and checked native states', () => {
		const { rerender } = render(<Checkbox checked={false} onChange={vi.fn()} label="Использовать" />);
		expect(screen.getByRole('checkbox', { name: 'Использовать' })).not.toBeChecked();
		rerender(<Checkbox checked onChange={vi.fn()} label="Использовать" />);
		expect(screen.getByRole('checkbox', { name: 'Использовать' })).toBeChecked();
	});

	it('supports focus and keyboard Space through the real input', () => {
		const onChange = vi.fn();
		render(<Checkbox checked={false} onChange={onChange} label="Использовать" />);
		const input = screen.getByRole('checkbox', { name: 'Использовать' });
		input.focus();
		expect(input).toHaveFocus();
		fireEvent.keyDown(input, { key: ' ' });
		fireEvent.click(input);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it('does not change when disabled', () => {
		const onChange = vi.fn();
		render(<Checkbox checked={false} disabled onChange={onChange} label="Использовать" />);
		const input = screen.getByRole('checkbox', { name: 'Использовать' });
		expect(input).toBeDisabled();
		fireEvent.click(input);
		expect(onChange).not.toHaveBeenCalled();
	});
});
