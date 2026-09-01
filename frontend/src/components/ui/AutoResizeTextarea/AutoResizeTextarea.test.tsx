import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { createStore, useStore } from 'zustand';
import { describe, expect, it } from 'vitest';
import { AutoResizeTextarea } from './AutoResizeTextarea';

function Harness() {
	const store = useMemo(() => createHarnessStore(), []);
	const value = useStore(store, (state) => state.value);
	const setValue = useStore(store, (state) => state.setValue);
	return <AutoResizeTextarea value={value} onChange={(event) => setValue(event.target.value)} />;
}

function createHarnessStore() {
	return createStore<{ value: string; setValue: (value: string) => void }>((set) => ({
		value: 'две\nстроки',
		setValue: (value) => set({ value }),
	}));
}

describe('AutoResizeTextarea', () => {
	it('keeps the controlled value stable while deleting characters', () => {
		render(<Harness />);
		const textarea = screen.getByRole('textbox');
		fireEvent.change(textarea, { target: { value: 'одна строка' } });
		expect(textarea).toHaveValue('одна строка');
		fireEvent.change(textarea, { target: { value: 'одна строк' } });
		expect(textarea).toHaveValue('одна строк');
	});
});
