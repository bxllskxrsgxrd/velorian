import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AutoResizeTextarea } from './AutoResizeTextarea';

function Harness() {
	const [value, setValue] = useState('две\nстроки');
	return <AutoResizeTextarea value={value} onChange={(event) => setValue(event.target.value)} />;
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
