import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('502 before stream metadata renders only the dedicated error UI', async ({ page }) => {
	await installMockApi(page, { streamError: true });
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Вызови ошибку');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();
	const alert = page.getByRole('alert').filter({ hasText: 'Не удалось получить ответ' });
	await expect(alert).toBeVisible();
	await expect(alert).toContainText('AI-сервис временно недоступен');
	await expect(alert).toContainText('e2e-502');
	await expect(page.locator('.message--error')).toHaveCount(1);
	await expect(page.locator('.message__content--pending')).toHaveCount(0);
	await expect(page.locator('.message--error .message__markdown')).toHaveCount(0);
});

test('connection toast reports loss and restoration', async ({ page }) => {
	await installMockApi(page, { failConversationsOnce: true });
	await page.goto('/');
	await expect(page.getByText('Соединение потеряно. Пытаемся восстановить…')).toBeVisible();
	await expect(page.getByText('Соединение восстановлено')).toBeVisible({ timeout: 5_000 });
});
