import { expect, test, type Locator } from '@playwright/test';
import { installMockApi } from './mockApi';

async function scrollbarSnapshot(locator: Locator) {
	return locator.evaluate((element) => {
		const style = getComputedStyle(element);
		const webkit = getComputedStyle(element, '::-webkit-scrollbar');
		return {
			overflowX: style.overflowX,
			overflowY: style.overflowY,
			scrollbarWidth: style.getPropertyValue('scrollbar-width'),
			scrollbarColor: style.getPropertyValue('scrollbar-color'),
			webkitWidth: webkit.width,
			webkitHeight: webkit.height,
			clientHeight: element.clientHeight,
			scrollHeight: element.scrollHeight,
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
		};
	});
}

function expectSharedScrollbar(snapshot: Awaited<ReturnType<typeof scrollbarSnapshot>>) {
	expect(snapshot.scrollbarWidth).toBe('thin');
	expect(snapshot.scrollbarColor).not.toBe('auto');
	expect(snapshot.webkitWidth).toBe('10px');
	expect(snapshot.webkitHeight).toBe('10px');
}

test('Knowledge, Sidebar and modal share one scrollbar at a small viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 600 });
	await installMockApi(page, { manyChats: true, manyKnowledge: true });
	await page.goto('/knowledge');
	await expect(page.locator('.knowledge-card')).toHaveCount(30);

	const knowledge = await scrollbarSnapshot(page.locator('.knowledge-page'));
	const sidebar = await scrollbarSnapshot(page.locator('.chat-sidebar__conversations'));
	expectSharedScrollbar(knowledge);
	expectSharedScrollbar(sidebar);
	expect(knowledge.scrollHeight).toBeGreaterThan(knowledge.clientHeight);
	expect(sidebar.scrollHeight).toBeGreaterThan(sidebar.clientHeight);
	expect(await page.evaluate(() => document.body.scrollHeight)).toBeLessThanOrEqual(600);

	await page.getByRole('button', { name: 'Добавить данные' }).click();
	await page.setViewportSize({ width: 1280, height: 430 });
	const modal = await scrollbarSnapshot(page.locator('.modal-dialog__content'));
	expectSharedScrollbar(modal);
	expect(modal.overflowY).toBe('auto');
	expect(modal.scrollHeight).toBeGreaterThan(modal.clientHeight);

	await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();
	await page.setViewportSize({ width: 1280, height: 600 });
	await page.getByRole('button', { name: 'Свернуть боковую панель' }).click();
	await expect(page.locator('.chat-sidebar')).toHaveCSS('width', '68px');
	await expect(page.locator('.chat-sidebar__conversations')).toHaveCSS('visibility', 'hidden');

	const pineColor = knowledge.scrollbarColor;
	for (const accent of ['terracotta', 'plum', 'pine']) {
		await page.evaluate((value) => { document.documentElement.dataset.accent = value; }, accent);
		const themed = await scrollbarSnapshot(page.locator('.knowledge-page'));
		expectSharedScrollbar(themed);
		expect(themed.scrollbarColor).toBe(pineColor);
	}
});

test('code blocks and multiline PromptBar keep matching horizontal and vertical scrollbars', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 700 });
	await installMockApi(page, { longMarkdown: true });
	await page.goto('/chat/c1');
	const textarea = page.getByRole('textbox', { name: 'Введите запрос' });
	await textarea.fill('Покажи длинную строку кода');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();

	const code = await scrollbarSnapshot(page.locator('.message__markdown pre'));
	expectSharedScrollbar(code);
	expect(code.overflowX).toBe('auto');
	expect(code.scrollWidth).toBeGreaterThan(code.clientWidth);

	await textarea.fill(Array.from({ length: 40 }, (_, index) => `Строка ${index + 1}: ${'текст '.repeat(12)}`).join('\n'));
	const prompt = await scrollbarSnapshot(textarea);
	expectSharedScrollbar(prompt);
	expect(prompt.overflowY).toBe('auto');
	expect(prompt.scrollHeight).toBeGreaterThan(prompt.clientHeight);
});
