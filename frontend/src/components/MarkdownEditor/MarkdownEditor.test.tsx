import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownEditor from './MarkdownEditor';

describe('MarkdownEditor', () => {
	it('previews an HTML file as one complete highlighted source block', async () => {
		const source = '<!doctype html>\n<html>\n<style>body { color: red; }</style>\n<script>const ready = true;</script>\n</html>';
		const { container } = render(
			<MarkdownEditor
				value={source}
				onChange={() => undefined}
				readonly
				fileName="velorian-design-guide-preview.html"
			/>,
		);

		expect(await screen.findByText('HTML')).toBeInTheDocument();
		expect(container.querySelectorAll('pre')).toHaveLength(1);
		expect(container.querySelector('pre')?.textContent).toBe(source);
		expect(container.querySelector('.token.tag')).toBeInTheDocument();
		expect(container.querySelector('.token.selector')).toBeInTheDocument();
		expect(container.querySelector('.token.keyword')).toBeInTheDocument();
	});
});
