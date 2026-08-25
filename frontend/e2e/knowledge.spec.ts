import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('opens Knowledge Base from sidebar and creates rated manual data', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'База знаний' }).click();
	await expect(page).toHaveURL(/\/knowledge/);
	await expect(page.getByRole('button', { name: 'База знаний' })).toHaveAttribute('aria-current', 'page');
	await page.getByRole('button', { name: 'Добавить данные' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Название').fill('Проверенный оффер');
	await dialog.getByLabel('Содержимое').fill('Текст для внутренней базы знаний');
	await dialog.getByRole('button', { name: 'Оценка 5 из 5' }).click();
	await dialog.getByRole('button', { name: 'Добавить' }).click();
	await expect(page.getByText('Проверенный оффер')).toBeVisible();
	await expect(page.getByRole('img', { name: /Рейтинг Проверенный оффер: 5 из 5/ })).toBeVisible();
	await page.getByRole('button', { name: 'Редактировать' }).click();
	const editDialog = page.getByRole('dialog');
	await editDialog.getByRole('button', { name: 'Оценка 4 из 5' }).click();
	await editDialog.getByRole('button', { name: 'Сохранить' }).click();
	await expect(page.getByRole('img', { name: /Рейтинг Проверенный оффер: 4 из 5/ })).toBeVisible();
	const filterRequest = page.waitForRequest((request) => request.url().includes('min_rating=4'));
	await page.getByLabel('Рейтинг', { exact: true }).selectOption('4');
	await filterRequest;
});
