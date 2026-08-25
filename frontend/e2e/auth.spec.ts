import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('login opens the app and logout returns to auth', async ({ page }) => {
	await installMockApi(page, { authenticated: false });
	await page.goto('/');
	await page.getByLabel('Email').fill('e2e@example.com');
	await page.getByLabel('Пароль').fill('strong-password');
	await page.getByRole('button', { name: 'Войти' }).click();
	await expect(page.getByRole('button', { name: 'Новый чат' })).toBeVisible();
	await page.getByRole('button', { name: /e2e@example.com/i }).click();
	await page.getByRole('button', { name: 'Выйти' }).click();
	await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});
