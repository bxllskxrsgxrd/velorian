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

	// Модалка добавления открывается на вкладке редактирования.
	const editTab = dialog.getByRole('tab', {
		name: 'Редактирование',
	});

	const previewTab = dialog.getByRole('tab', {
		name: 'Предпросмотр',
	});

	await expect(editTab).toHaveAttribute('aria-selected', 'true');
	await expect(previewTab).toHaveAttribute('aria-selected', 'false');

	// Рейтинг содержит пять интерактивных звёзд.
	const ratingButtons = dialog.locator('.rating__star');

	await expect(ratingButtons).toHaveCount(5);

	// Hover подсвечивает нужное количество звёзд.
	await dialog.getByRole('button', { name: 'Поставить рейтинг 3 из 5' }).hover();

	await expect(dialog.locator('.rating__star--active')).toHaveCount(3);
	await expect(dialog.locator('.rating__star--inactive')).toHaveCount(2);

	// Заполняем основные данные.
	await dialog.getByLabel('Название').fill('Проверенный оффер');

	await dialog.getByLabel('Содержимое').fill('Текст для внутренней базы знаний');

	// Добавляем подход.
	await dialog.getByRole('button', { name: 'Новый подход' }).click();

	await dialog.getByLabel('Название нового подхода').fill('UGC-разбор');

	await dialog
		.getByRole('button', {
			name: 'Создать',
			exact: true,
		})
		.click();

	await expect(dialog.getByLabel('Подход элемента')).toHaveValue(/.+/);

	// Выбираем рейтинг.
	const ratingThree = dialog.getByRole('button', {
		name: 'Поставить рейтинг 3 из 5',
	});

	await ratingThree.click();

	await expect(ratingThree).toHaveAttribute('aria-pressed', 'true');

	await expect(dialog.locator('.rating__star--active')).toHaveCount(3);

	// Проверяем preview до сохранения.
	await previewTab.click();

	await expect(previewTab).toHaveAttribute('aria-selected', 'true');
	await expect(editTab).toHaveAttribute('aria-selected', 'false');

	const createPreview = dialog.getByRole('tabpanel');

	await expect(
		createPreview.getByRole('heading', {
			name: 'Проверенный оффер',
		}),
	).toBeVisible();

	await expect(createPreview.getByText('Подход · UGC-разбор')).toBeVisible();

	await expect(createPreview.getByText(/Добавлено вручную ·/)).toBeVisible();

	// Незаполненные метаданные не появляются.
	await expect(createPreview.getByText(/ГЕО ·/)).toHaveCount(0);
	await expect(createPreview.getByText(/Селеба ·/)).toHaveCount(0);
	await expect(createPreview.getByText(/Оффер ·/)).toHaveCount(0);
	await expect(createPreview.getByText(/Новостник ·/)).toHaveCount(0);

	// Возвращаемся и сохраняем.
	await editTab.click();

	await expect(editTab).toHaveAttribute('aria-selected', 'true');

	await dialog.getByRole('button', { name: 'Добавить данные' }).click();

	await expect(
		page.getByText('Проверенный оффер', {
			exact: true,
		}),
	).toBeVisible();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Проверенный оффер: 3 из 5/,
		}),
	).toBeVisible();

	// Числовой рейтинг больше не выводится.
	await expect(
		page.getByText('3/5', {
			exact: true,
		}),
	).toHaveCount(0);

	await expect(page.getByText('Подход: UGC-разбор')).toBeVisible();

	await expect(
		page.getByRole('checkbox', {
			name: 'Использовать',
		}),
	).toBeChecked();

	// Bulk selection.
	const selectCheckbox = page.getByRole('checkbox', {
		name: 'Выбрать Проверенный оффер',
	});

	const selectCheckboxLabel = page.locator('label.checkbox').filter({
		hasText: 'Выбрать Проверенный оффер',
	});

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

	await bulkBar
		.getByRole('button', {
			name: 'Снять выбор',
		})
		.click();

	await expect(selectCheckbox).not.toBeChecked();
	await expect(bulkBar).not.toBeVisible();

	// Данные сохраняются после reload.
	await page.reload();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Проверенный оффер: 3 из 5/,
		}),
	).toBeVisible();

	await expect(page.getByText('3/5', { exact: true })).toHaveCount(0);

	// Редактирование.
	await page
		.getByRole('button', {
			name: 'Редактировать',
		})
		.click();

	const editDialog = page.getByRole('dialog');

	const editDialogTab = editDialog.getByRole('tab', {
		name: 'Редактирование',
	});

	const editPreviewTab = editDialog.getByRole('tab', {
		name: 'Предпросмотр',
	});

	await expect(editDialogTab).toHaveAttribute('aria-selected', 'true');

	await expect(editPreviewTab).toHaveAttribute('aria-selected', 'false');

	await expect(editDialog.locator('.rating__star')).toHaveCount(5);

	await expect(editDialog.locator('.rating__star--active')).toHaveCount(3);

	await expect(editDialog.locator('.rating__star--inactive')).toHaveCount(2);

	const ratingFive = editDialog.getByRole('button', {
		name: 'Поставить рейтинг 5 из 5',
	});

	await ratingFive.click();

	await expect(ratingFive).toHaveAttribute('aria-pressed', 'true');

	await expect(editDialog.locator('.rating__star--active')).toHaveCount(5);

	// Preview редактирования.
	await editPreviewTab.click();

	await expect(editPreviewTab).toHaveAttribute('aria-selected', 'true');

	const editPreview = editDialog.getByRole('tabpanel');

	await expect(
		editPreview.getByRole('heading', {
			name: 'Проверенный оффер',
		}),
	).toBeVisible();

	await expect(editPreview.getByText('Текст для внутренней базы знаний')).toBeVisible();

	await expect(editPreview.getByText('Подход · UGC-разбор')).toBeVisible();

	await expect(editPreview.getByText(/ГЕО ·/)).toHaveCount(0);
	await expect(editPreview.getByText(/Селеба ·/)).toHaveCount(0);
	await expect(editPreview.getByText(/Оффер ·/)).toHaveCount(0);
	await expect(editPreview.getByText(/Новостник ·/)).toHaveCount(0);

	await editDialogTab.click();

	await editDialog
		.getByRole('button', {
			name: 'Сохранить изменения',
		})
		.click();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Проверенный оффер: 5 из 5/,
		}),
	).toBeVisible();

	await expect(page.getByText('5/5', { exact: true })).toHaveCount(0);

	// Рейтинг переживает reload.
	await page.reload();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Проверенный оффер: 5 из 5/,
		}),
	).toBeVisible();

	// Отключаем использование записи агентом.
	await page
		.locator('label.checkbox')
		.filter({
			hasText: 'Использовать',
		})
		.click();

	await expect(
		page.getByRole('checkbox', {
			name: 'Использовать',
		}),
	).not.toBeChecked();

	await page.reload();

	await expect(
		page.getByRole('checkbox', {
			name: 'Использовать',
		}),
	).not.toBeChecked();

	const controls = page.getByRole('region', {
		name: 'Управление базой знаний',
	});

	// Фильтры.
	await controls
		.getByRole('button', {
			name: /^Фильтры/,
		})
		.click();

	const filtersDropdown = page.locator('.knowledge-page__dropdown--filters');

	await expect(filtersDropdown).toBeVisible();

	const ratingSelect = filtersDropdown.locator('label').filter({ hasText: 'Рейтинг' }).locator('select');

	const sourceSelect = filtersDropdown.locator('label').filter({ hasText: 'Источник' }).locator('select');

	const approachSelect = filtersDropdown.locator('label').filter({ hasText: 'Подход' }).locator('select');

	const activeSelect = filtersDropdown.locator('label').filter({ hasText: 'Использование' }).locator('select');

	await Promise.all([
		page.waitForRequest((request) => request.url().includes('min_rating=4')),
		ratingSelect.selectOption('4'),
	]);

	await expect(ratingSelect).toHaveValue('4');

	await sourceSelect.selectOption('manual');

	await expect(sourceSelect).toHaveValue('manual');

	await approachSelect.selectOption({
		label: 'UGC-разбор',
	});

	await expect(approachSelect).not.toHaveValue('');

	await activeSelect.selectOption('inactive');

	await expect(activeSelect).toHaveValue('inactive');

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

	// Сортировка.
	await controls
		.getByRole('button', {
			name: 'Сортировка',
		})
		.click();

	const sortDropdown = page.locator('.knowledge-page__dropdown--sort');

	await expect(sortDropdown).toBeVisible();

	await sortDropdown
		.getByRole('button', {
			name: 'Рейтинг: высокий',
		})
		.click();

	await expect(sortDropdown).not.toBeVisible();

	// Поиск.
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

	// Сбрасываем только фильтры.
	await controls
		.getByRole('button', {
			name: /^Фильтры/,
		})
		.click();

	await expect(filtersDropdown).toBeVisible();

	const reset = filtersDropdown.getByRole('button', {
		name: 'Сбросить',
	});

	await expect(reset).toBeEnabled();

	await reset.click();

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

	// Здесь тоже новое название confirm-кнопки.
	await dialog.getByRole('button', { name: 'Добавить данные' }).click();

	await page.getByRole('button', { name: 'Новый чат' }).click();

	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Что находится в моей базе знаний?');

	await page.getByRole('button', { name: 'Отправить сообщение' }).click();

	await expect(page.getByText(/В вашей базе знаний: Facebook Hooks/)).toBeVisible();

	await page.getByLabel('Открыть меню действий').click();

	await page.getByRole('menuitemradio', { name: 'Поиск по базе знаний' }).click();

	await page
		.getByRole('textbox', { name: 'Введите запрос' })
		.pressSequentially('Какой angle использовать для health Facebook?');

	const send = page.getByRole('button', {
		name: 'Отправить сообщение',
	});

	await expect(send).toBeEnabled();

	await send.click();

	await expect(page.getByText(/curiosity angle/)).toBeVisible();
});
