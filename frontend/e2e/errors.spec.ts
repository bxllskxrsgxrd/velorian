import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('502 before stream metadata renders only the dedicated error UI', async ({ page }) => {
	await installMockApi(page, { streamError: true });
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Вызови ошибку');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();
	const alert = page.getByRole('alert');
	await expect(alert).toBeVisible();
	await expect(alert).toContainText('AI-сервис временно недоступен');
	await expect(alert).toContainText('e2e-502');
	await expect(alert).not.toContainText('provider details');
	await expect(page.locator('.message--error')).toHaveCount(1);
	await expect(page.locator('.message__error')).toBeVisible();
	await expect(page.locator('.message__error-title')).toBeVisible();
	await expect(page.locator('.message__error-description')).toBeVisible();
	await expect(page.locator('.message__error-icon')).toBeVisible();
	await expect(page.locator('.message__content--pending')).toHaveCount(0);
	await expect(page.locator('.message--error .message__markdown')).toHaveCount(0);
});

test('connection toast reports loss and restoration', async ({ page }) => {
	await installMockApi(page, { failConversationsOnce: true });
	await page.goto('/');
	await expect(page.getByText('Соединение потеряно. Пытаемся восстановить…')).toBeVisible();
	await expect(page.getByText('Соединение восстановлено')).toBeVisible({ timeout: 5_000 });
});

test('historical empty cancelled message becomes a complete ErrorMessage after reload', async ({ page }) => {
	await installMockApi(page, { historicalError: 'cancelled' });
	await page.goto('/chat/c1');
	await page.reload();
	const alert = page.locator('#message-historical-error');
	await expect(alert).toHaveAttribute('role', 'alert');
	await expect(alert.locator('.message__error')).toBeVisible();
	await expect(alert.locator('.message__error-icon')).toBeVisible();
	await expect(alert.locator('.message__error-title')).toHaveText('Не удалось получить ответ');
	await expect(alert.locator('.message__error-description')).toContainText('При выполнении запроса произошла ошибка');
	await expect(alert.locator('.message__error-actions').getByRole('button', { name: 'Повторить' })).toBeVisible();
	await expect(alert.locator('.message__content--pending')).toHaveCount(0);
});
