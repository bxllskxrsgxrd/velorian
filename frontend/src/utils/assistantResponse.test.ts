import { describe, expect, it } from 'vitest';
import { splitAssistantResponse } from './assistantResponse';

describe('splitAssistantResponse', () => {
	it('splits a bold heading from the response body', () => {
		expect(splitAssistantResponse('**Poem**\n\nSoftly falls the evening light,\nAnd old winds whisper in the shade.')).toEqual({
			title: 'Poem',
			content: 'Softly falls the evening light,\nAnd old winds whisper in the shade.',
		});
	});

	it('splits a bold title wrapped in an ordered-list marker', () => {
		expect(splitAssistantResponse('1. **Ласковый след**\n\nТихий шёпот утра,\nИ хвост, как клятва, виляя,')).toEqual({
			title: 'Ласковый след',
			content: 'Тихий шёпот утра,\nИ хвост, как клятва, виляя,',
		});
	});

	it('splits an ATX heading and preserves the body exactly', () => {
		expect(splitAssistantResponse('\n## **Poem**\r\n\r\nFirst line\r\n\r\nSecond line\r\n')).toEqual({
			title: 'Poem',
			content: 'First line\r\n\r\nSecond line\r\n',
		});
	});

	it('does not remove a plain first line used as the fallback title', () => {
		const response = 'Softly falls the evening light,\nAnd old winds whisper in the shade.';
		expect(splitAssistantResponse(response)).toEqual({
			title: 'Softly falls the evening light,',
			content: response,
		});
	});

	it('does not treat an arbitrary ordered-list item as a title', () => {
		const response = '1. Обычный пункт\n2. Следующий пункт';
		expect(splitAssistantResponse(response)).toEqual({
			title: '1. Обычный пункт',
			content: response,
		});
	});
});
