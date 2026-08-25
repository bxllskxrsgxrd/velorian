import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('creates a chat, sends a message and rates the answer', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Новый чат' }).click();
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Тестовый запрос');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();
	await expect(page.getByText('Ответ агента')).toBeVisible();
	await page.getByRole('button', { name: 'Оценка 5 из 5' }).click();
	await expect(page.getByRole('button', { name: 'Оценка 5 из 5' })).toHaveAttribute('aria-pressed', 'true');
});

test('large paste becomes a txt attachment', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	const textarea = page.getByRole('textbox', { name: 'Введите запрос' });
	await textarea.evaluate((element) => {
		const transfer = new DataTransfer();
		transfer.setData('text/plain', `Юникод\n${'данные '.repeat(13_000)}`);
		element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
	});
	await expect(page.getByText(/pasted-text-.*\.txt/)).toBeVisible();
	await expect(textarea).toHaveValue('');
});

test('knowledge search is active and sent as search_mode', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	await page.getByLabel('Открыть меню действий').click();
	await page.getByRole('menuitemradio', { name: 'Поиск по базе знаний' }).click();
	const requestPromise = page.waitForRequest((request) => request.url().includes('/stream') && (request.postData() ?? '').includes('knowledge'));
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('◈ Поиск по базе знаний оффер');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();
	const request = await requestPromise;
	expect(request.postData()).toContain('search_mode');
	expect(request.postData()).toContain('knowledge');
});
