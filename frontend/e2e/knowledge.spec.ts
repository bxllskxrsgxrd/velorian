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
	const formStars = dialog.locator('.rating__star svg');
	await expect(formStars).toHaveCount(5);
	const starRendering = await formStars.first().evaluate((svg) => {
		const box = svg.getBoundingClientRect();
		const style = getComputedStyle(svg);
		const buttonStyle = getComputedStyle(svg.closest('button')!);
		return {
			width: box.width,
			height: box.height,
			display: style.display,
			opacity: style.opacity,
			stroke: style.stroke,
			buttonPadding: buttonStyle.padding,
			buttonBorderWidth: buttonStyle.borderWidth,
		};
	});
	expect(starRendering).toMatchObject({
		width: 18,
		height: 18,
		display: 'block',
		opacity: '1',
		buttonPadding: '0px',
		buttonBorderWidth: '0px',
	});
	expect(starRendering.stroke).not.toBe('none');
	await dialog.getByRole('button', { name: 'Поставить рейтинг 3 из 5' }).hover();
	await expect(dialog.locator('.rating__star--active')).toHaveCount(3);
	await dialog.getByLabel('Название').fill('Проверенный оффер');
	await dialog.getByLabel('Содержимое').fill('Текст для внутренней базы знаний');
	await dialog.getByRole('button', { name: 'Создать новый подход' }).click();
	await dialog.getByLabel('Название нового подхода').fill('UGC-разбор');
	await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
	await dialog.getByRole('button', { name: 'Поставить рейтинг 3 из 5' }).click();

	await dialog.getByRole('button', { name: 'Добавить' }).click();

	await expect(page.getByText('Проверенный оффер', { exact: true })).toBeVisible();

	await expect(page.getByRole('img', { name: /Рейтинг Проверенный оффер: 3 из 5/ })).toBeVisible();

	await expect(page.getByText('3/5')).toBeVisible();

	await expect(page.getByText('Подход: UGC-разбор')).toBeVisible();

	await expect(page.getByRole('checkbox', { name: 'Использовать' })).toBeChecked();

	const selectCheckbox = page.getByRole('checkbox', {
		name: 'Выбрать Проверенный оффер',
	});

	const selectCheckboxLabel = page.locator('label.checkbox').filter({ hasText: 'Выбрать Проверенный оффер' });

	await expect(selectCheckbox).not.toBeChecked();

	await selectCheckboxLabel.click();

	await expect(selectCheckbox).toBeChecked();

	const bulkBar = page.getByRole('region', {
		name: 'Действия с выбранными элементами',
	});

	await expect(bulkBar).toBeVisible();

	await expect(bulkBar.getByText('Выбрано: 1')).toBeVisible();

	await expect(
		bulkBar.getByRole('button', {
			name: 'Выбрать все 1',
		}),
	).toBeDisabled();

	await bulkBar.getByRole('button', { name: 'Снять выбор' }).click();

	await expect(selectCheckbox).not.toBeChecked();

	await expect(bulkBar).not.toBeVisible();

	await page.reload();
	await expect(page.getByRole('img', { name: /Рейтинг Проверенный оффер: 3 из 5/ })).toBeVisible();
	await page.getByRole('button', { name: 'Редактировать' }).click();
	const editDialog = page.getByRole('dialog');
	await expect(editDialog.locator('.rating__star svg')).toHaveCount(5);
	await expect(editDialog.locator('.rating__star--active')).toHaveCount(3);
	await expect(editDialog.locator('.rating__star--inactive')).toHaveCount(2);
	await editDialog.getByRole('button', { name: 'Поставить рейтинг 5 из 5' }).click();
	await editDialog.getByRole('button', { name: 'Сохранить' }).click();
	await expect(page.getByRole('img', { name: /Рейтинг Проверенный оффер: 5 из 5/ })).toBeVisible();
	await page.reload();
	await expect(page.getByText('5/5')).toBeVisible();
	await page.locator('label.checkbox').filter({ hasText: 'Использовать' }).click();
	await expect(page.getByRole('checkbox', { name: 'Использовать' })).not.toBeChecked();
	await page.reload();

	await expect(page.getByRole('checkbox', { name: 'Использовать' })).not.toBeChecked();

	const controls = page.getByRole('region', {
		name: 'Управление базой знаний',
	});

	// Открываем фильтры
	await controls.getByRole('button', { name: /^Фильтры/ }).click();

	const filtersDropdown = page.locator('.knowledge-page__dropdown--filters');

	await expect(filtersDropdown).toBeVisible();

	// Не используем getByLabel для select.
	// Находим конкретный label, а внутри него select.
	const ratingSelect = filtersDropdown.locator('label').filter({ hasText: 'Рейтинг' }).locator('select');

	const sourceSelect = filtersDropdown.locator('label').filter({ hasText: 'Источник' }).locator('select');

	const approachSelect = filtersDropdown.locator('label').filter({ hasText: 'Подход' }).locator('select');

	const activeSelect = filtersDropdown.locator('label').filter({ hasText: 'Использование' }).locator('select');

	// Рейтинг
	await Promise.all([
		page.waitForRequest((request) => request.url().includes('min_rating=4')),
		ratingSelect.selectOption('4'),
	]);

	await expect(ratingSelect).toHaveValue('4');

	// Источник
	await sourceSelect.selectOption('manual');

	await expect(sourceSelect).toHaveValue('manual');

	// Подход
	await approachSelect.selectOption({
		label: 'UGC-разбор',
	});

	await expect(approachSelect).not.toHaveValue('');

	// Использование
	await activeSelect.selectOption('inactive');

	await expect(activeSelect).toHaveValue('inactive');

	// Проверяем, что фильтры реально попали в URL
	await expect
		.poll(() => {
			const url = new URL(page.url());

			return {
				rating: url.searchParams.get('rating'),
				source: url.searchParams.get('source'),
				approach: url.searchParams.get('approach'),
				active: url.searchParams.get('active'),
			};
		})
		.toEqual({
			rating: '4',
			source: 'manual',
			approach: expect.any(String),
			active: 'inactive',
		});

	// Открываем сортировку.
	// Это автоматически заменит dropdown фильтров на dropdown сортировки.
	await controls.getByRole('button', { name: 'Сортировка' }).click();

	const sortDropdown = page.locator('.knowledge-page__dropdown--sort');

	await expect(sortDropdown).toBeVisible();

	await sortDropdown.getByRole('button', { name: 'Рейтинг: высокий' }).click();

	await expect(sortDropdown).not.toBeVisible();

	// Поиск
	await page.getByLabel('Поиск по базе знаний').fill('оффер');

	await expect
		.poll(() => {
			const url = new URL(page.url());

			return {
				search: url.searchParams.get('q'),
				sort: url.searchParams.get('sort'),
			};
		})
		.toEqual({
			search: 'оффер',
			sort: 'rating_desc',
		});

	// Снова открываем фильтры для сброса
	await controls.getByRole('button', { name: /^Фильтры/ }).click();

	await expect(filtersDropdown).toBeVisible();

	const reset = filtersDropdown.getByRole('button', {
		name: 'Сбросить',
	});

	await expect(reset).toBeEnabled();

	await reset.click();

	// Сбрасываются ТОЛЬКО фильтры.
	// Поиск и сортировка остаются.
	await expect
		.poll(() => {
			const url = new URL(page.url());

			return {
				pathname: url.pathname,
				search: url.searchParams.get('q'),
				sort: url.searchParams.get('sort'),
				rating: url.searchParams.get('rating'),
				source: url.searchParams.get('source'),
				approach: url.searchParams.get('approach'),
				active: url.searchParams.get('active'),
				geo: url.searchParams.get('geo'),
				celebrity: url.searchParams.get('celebrity'),
				offer: url.searchParams.get('offer'),
				newsSource: url.searchParams.get('news_source'),
			};
		})
		.toEqual({
			pathname: '/knowledge',
			search: 'оффер',
			sort: 'rating_desc',

			rating: null,
			source: null,
			approach: null,
			active: null,
			geo: null,
			celebrity: null,
			offer: null,
			newsSource: null,
		});

	await expect(reset).toBeDisabled();
});

test('agent can browse and search the current user knowledge through chat', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/knowledge');
	await page.getByRole('button', { name: 'Добавить данные' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Название').fill('Facebook Hooks');
	await dialog.getByLabel('Содержимое').fill('Для health-офферов используем curiosity angle.');
	await dialog.getByRole('button', { name: 'Добавить' }).click();

	await page.getByRole('button', { name: 'Новый чат' }).click();
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Что находится в моей базе знаний?');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();
	await expect(page.getByText(/В вашей базе знаний: Facebook Hooks/)).toBeVisible();

	await page.getByLabel('Открыть меню действий').click();
	await page.getByRole('menuitemradio', { name: 'Поиск по базе знаний' }).click();
	await page
		.getByRole('textbox', { name: 'Введите запрос' })
		.pressSequentially('Какой angle использовать для health Facebook?');
	const send = page.getByRole('button', { name: 'Отправить сообщение' });
	await expect(send).toBeEnabled();
	await send.click();
	await expect(page.getByText(/curiosity angle/)).toBeVisible();
});
