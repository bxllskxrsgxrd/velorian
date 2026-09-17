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

function expectStyledScrollbar(snapshot: Awaited<ReturnType<typeof scrollbarSnapshot>>) {
	expect(snapshot.scrollbarWidth).toBe('thin');
	expect(snapshot.scrollbarColor).not.toBe('auto');
	expect(snapshot.webkitWidth).toBe('10px');
	expect(snapshot.webkitHeight).toBe('10px');
}

test('Knowledge and editor keep one vertical scroll container at a small viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 600 });
	await installMockApi(page, { manyChats: true, manyKnowledge: true });
	await page.goto('/knowledge');
	await expect(page.locator('.knowledge-card')).toHaveCount(30);

	const knowledge = await scrollbarSnapshot(page.locator('.knowledge-page'));
	const sidebar = await scrollbarSnapshot(page.locator('.chat-sidebar__conversations'));

	// Knowledge now owns the page-level scroll. Do not require the old custom
	// scrollbar-width/color contract here; only verify that it is the active
	// vertical scroll container and that body itself does not become scrollable.
	expect(knowledge.scrollHeight).toBeGreaterThan(knowledge.clientHeight);
	expect(await page.evaluate(() => document.body.scrollHeight)).toBeLessThanOrEqual(600);

	// Sidebar keeps the shared custom scrollbar styling.
	expectStyledScrollbar(sidebar);
	expect(sidebar.scrollHeight).toBeGreaterThan(sidebar.clientHeight);

	// Accent changes must not mutate the shared Sidebar scrollbar style.
	const sidebarScrollbarColor = sidebar.scrollbarColor;
	for (const accent of ['terracotta', 'plum', 'pine']) {
		await page.evaluate((value) => {
			document.documentElement.dataset.accent = value;
		}, accent);

		const themedSidebar = await scrollbarSnapshot(page.locator('.chat-sidebar__conversations'));
		expectStyledScrollbar(themedSidebar);
		expect(themedSidebar.scrollbarColor).toBe(sidebarScrollbarColor);
	}

	await page.getByRole('button', { name: 'Добавить данные' }).click();
	await expect(page).toHaveURL(/\/knowledge\/new$/);
	await page.setViewportSize({ width: 1280, height: 430 });

	const editor = page.getByRole('region', { name: 'Добавить данные' });
	const editorPage = await scrollbarSnapshot(page.locator('.knowledge-editor-page'));
	const editorForm = await scrollbarSnapshot(editor.locator('.knowledge-edit-modal__form'));

	// Editor page is the only vertical scroll container. The inner form must not
	// create the old second scrollbar.
	expect(editorPage.overflowY).toBe('auto');
	expect(editorPage.scrollHeight).toBeGreaterThan(editorPage.clientHeight);
	expect(editorForm.overflowY).toBe('visible');

	await editor.getByRole('button', { name: 'Отмена' }).click();
	await expect(page).toHaveURL(/\/knowledge$/);

	await page.setViewportSize({ width: 1280, height: 600 });
	await page.getByRole('button', { name: 'Свернуть боковую панель' }).click();
	await expect(page.locator('.chat-sidebar')).toHaveCSS('width', '68px');
	await expect(page.locator('.chat-sidebar__conversations')).toHaveCSS('visibility', 'hidden');
});

test('code blocks and multiline PromptBar keep matching horizontal and vertical scrollbars', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 700 });
	await installMockApi(page, { longMarkdown: true });
	await page.goto('/chat/c1');

	const textarea = page.getByRole('textbox', { name: 'Введите запрос' });
	await textarea.fill('Покажи длинную строку кода');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();

	const code = await scrollbarSnapshot(page.locator('.message__markdown pre'));
	expectStyledScrollbar(code);
	expect(code.overflowX).toBe('auto');
	expect(code.scrollWidth).toBeGreaterThan(code.clientWidth);

	await textarea.fill(
		Array.from({ length: 40 }, (_, index) => `Строка ${index + 1}: ${'текст '.repeat(12)}`).join('\n'),
	);

	const prompt = await scrollbarSnapshot(textarea);
	expectStyledScrollbar(prompt);
	expect(prompt.overflowY).toBe('auto');
	expect(prompt.scrollHeight).toBeGreaterThan(prompt.clientHeight);
});
