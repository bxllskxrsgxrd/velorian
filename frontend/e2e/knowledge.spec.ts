import { expect, test, type Locator, type Page } from '@playwright/test';

import { installMockApi } from './mockApi';

async function selectCustomOption(page: Page, trigger: Locator, optionName: string) {
	await trigger.click();

	const option = page.getByRole('option', {
		name: optionName,
		exact: true,
	});

	if (await option.isVisible().catch(() => false)) {
		await option.click();
		return;
	}

	await page
		.getByText(optionName, {
			exact: true,
		})
		.last()
		.click();
}

test('shows unified approach cards with editable rating and inactive state', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/knowledge/approaches');

	const interviewCard = page.locator('article.knowledge-card').filter({ hasText: 'Интервью' });
	const showCard = page.locator('article.knowledge-card').filter({ hasText: 'Шоу' });

	await expect(interviewCard).toContainText('Связанных материалов: 3');
	await expect(interviewCard.locator('.rating__star')).toHaveCount(5);
	await expect(interviewCard.locator(':scope > .knowledge-card__select-column')).toHaveCount(1);
	await expect(showCard.locator('.rating__star--active')).toHaveCount(5);

	await interviewCard.locator('label.knowledge-card__select').click();
	const bulkBar = page.getByRole('region', { name: 'Действия с выбранными подходами' });
	await expect(interviewCard).toHaveClass(/knowledge-card--selected/);
	await expect(bulkBar).toContainText('Выбрано: 1');
	await bulkBar.getByRole('button', { name: 'Снять выбор' }).click();
	await expect(bulkBar).not.toBeVisible();
	await expect(page.locator('.knowledge-page__bulk-slot')).toHaveCount(1);

	await showCard.getByText('Подход активен').click();
	await expect(showCard).toHaveClass(/knowledge-card--inactive/);

	const ratingFour = interviewCard.getByRole('button', { name: 'Поставить рейтинг 4 из 5' });
	await ratingFour.click();
	await expect(ratingFour).toHaveAttribute('aria-pressed', 'true');
	await expect(interviewCard.getByRole('checkbox', { name: 'Подход активен' })).toBeChecked();

	await page.getByRole('button', { name: 'Сортировка' }).click();
	await page.getByRole('button', { name: 'Рейтинг: высокий' }).click();
	await expect(page.locator('article.knowledge-card').first()).toContainText('Шоу');
});

test('opens Knowledge Base from sidebar and creates rated manual data', async ({ page }) => {
	await installMockApi(page);

	await page.goto('/');

	await page.getByRole('button', { name: 'База знаний' }).click();

	await expect(page).toHaveURL(/\/knowledge/);

	await expect(page.getByRole('button', { name: 'База знаний' })).toHaveAttribute('aria-current', 'page');

	await page.getByRole('button', { name: 'Добавить данные' }).click();

	await expect(page).toHaveURL(/\/knowledge\/new$/);
	const editor = page.getByRole('region', { name: 'Добавить данные' });

	// Страница добавления открывается на вкладке редактирования
	const editTab = editor.getByRole('tab', {
		name: 'Редактирование',
	});

	const previewTab = editor.getByRole('tab', {
		name: 'Предпросмотр',
	});

	await expect(editTab).toHaveAttribute('aria-selected', 'true');
	await expect(previewTab).toHaveAttribute('aria-selected', 'false');

	// Рейтинг содержит пять интерактивных звёзд
	const ratingButtons = editor.locator('.rating__star');

	await expect(ratingButtons).toHaveCount(5);

	// Hover подсвечивает нужное количество звёзд
	await editor.getByRole('button', { name: 'Поставить рейтинг 3 из 5' }).hover();

	await expect(editor.locator('.rating__star--active')).toHaveCount(3);
	await expect(editor.locator('.rating__star--inactive')).toHaveCount(2);

	// Заполняем основные данные
	await editor.getByLabel('Название').fill('Тестовый материал');

	await editor.getByLabel('Содержимое').fill('Текст для внутренней базы знаний');

	// Knowledge-форма только выбирает существующий глобальный подход
	const createApproachSelect = editor.getByLabel('Подход элемента');
	await selectCustomOption(page, createApproachSelect, 'Интервью');
	await expect(createApproachSelect).toContainText('Интервью');

	// Выбираем рейтинг
	const ratingThree = editor.getByRole('button', {
		name: 'Поставить рейтинг 3 из 5',
	});

	await ratingThree.click();

	await expect(ratingThree).toHaveAttribute('aria-pressed', 'true');

	await expect(editor.locator('.rating__star--active')).toHaveCount(3);

	// Проверяем preview до сохранения
	await previewTab.click();

	await expect(previewTab).toHaveAttribute('aria-selected', 'true');
	await expect(editTab).toHaveAttribute('aria-selected', 'false');

	const createPreview = editor.getByRole('tabpanel');

	await expect(
		createPreview.getByRole('heading', {
			name: 'Тестовый материал',
		}),
	).toBeVisible();

	await expect(createPreview.getByText('Подход · Интервью')).toBeVisible();

	await expect(createPreview.getByText(/Добавлено вручную ·/)).toBeVisible();

	// Незаполненные метаданные не появляются
	await expect(createPreview.getByText(/Гео ·/)).toHaveCount(0);
	await expect(createPreview.getByText(/Персонаж ·/)).toHaveCount(0);
	await expect(createPreview.getByText(/Оффер ·/)).toHaveCount(0);
	await expect(createPreview.getByText(/Источник ·/)).toHaveCount(0);

	// Возвращаемся и сохраняем
	await editTab.click();

	await expect(editTab).toHaveAttribute('aria-selected', 'true');

	await editor.getByRole('button', { name: 'Добавить данные' }).click();
	await expect(page).toHaveURL(/\/knowledge\/k1$/);

	const savedEditor = page.getByRole('region', { name: 'Редактировать данные' });
	await savedEditor.getByRole('button', { name: 'Отмена' }).click();
	await expect(page).toHaveURL(/\/knowledge$/);

	await expect(
		page.getByText('Тестовый материал', {
			exact: true,
		}),
	).toBeVisible();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Тестовый материал: 3 из 5/,
		}),
	).toBeVisible();

	// Числовой рейтинг больше не выводится
	await expect(
		page.getByText('3/5', {
			exact: true,
		}),
	).toHaveCount(0);

	await expect(page.getByText('Подход: Интервью')).toBeVisible();

	await expect(
		page.getByRole('checkbox', {
			name: 'Использовать в ответах',
		}),
	).toBeChecked();

	// Bulk selection
	const selectCheckbox = page.getByRole('checkbox', {
		name: 'Выбрать Тестовый материал',
	});

	const selectCheckboxLabel = page.locator('label.checkbox').filter({
		hasText: 'Выбрать Тестовый материал',
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

	// Данные сохраняются после reload
	await page.reload();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Тестовый материал: 3 из 5/,
		}),
	).toBeVisible();

	await expect(page.getByText('3/5', { exact: true })).toHaveCount(0);

	// Редактирование через контекстное меню карточки
	const knowledgeCard = page.locator('article.knowledge-card').filter({
		hasText: 'Тестовый материал',
	});

	await expect(knowledgeCard).toBeVisible();

	await knowledgeCard.click({
		button: 'right',
		position: { x: 120, y: 80 },
	});

	const cardMenu = page.getByRole('menu', {
		name: 'Действия с записью «Тестовый материал»',
	});

	await expect(cardMenu).toBeVisible();

	await cardMenu
		.getByRole('menuitem', {
			name: 'Редактировать',
		})
		.click();

	await expect(page).toHaveURL(/\/knowledge\/k1$/);
	const editPage = page.getByRole('region', { name: 'Редактировать данные' });

	const editPageTab = editPage.getByRole('tab', {
		name: 'Редактирование',
	});

	const editPreviewTab = editPage.getByRole('tab', {
		name: 'Предпросмотр',
	});

	await expect(editPageTab).toHaveAttribute('aria-selected', 'true');

	await expect(editPreviewTab).toHaveAttribute('aria-selected', 'false');

	await expect(editPage.locator('.rating__star')).toHaveCount(5);

	await expect(editPage.locator('.rating__star--active')).toHaveCount(3);

	await expect(editPage.locator('.rating__star--inactive')).toHaveCount(2);

	const ratingFive = editPage.getByRole('button', {
		name: 'Поставить рейтинг 5 из 5',
	});

	await ratingFive.click();

	await expect(ratingFive).toHaveAttribute('aria-pressed', 'true');

	await expect(editPage.locator('.rating__star--active')).toHaveCount(5);

	// Preview редактирования
	await editPreviewTab.click();

	await expect(editPreviewTab).toHaveAttribute('aria-selected', 'true');

	const editPreview = editPage.getByRole('tabpanel');

	await expect(
		editPreview.getByRole('heading', {
			name: 'Тестовый материал',
		}),
	).toBeVisible();

	await expect(editPreview.getByText('Текст для внутренней базы знаний')).toBeVisible();

	await expect(editPreview.getByText('Подход · Интервью')).toBeVisible();

	await expect(editPreview.getByText(/Гео ·/)).toHaveCount(0);
	await expect(editPreview.getByText(/Персонаж ·/)).toHaveCount(0);
	await expect(editPreview.getByText(/Оффер ·/)).toHaveCount(0);
	await expect(editPreview.getByText(/Источник ·/)).toHaveCount(0);

	await editPageTab.click();

	await editPage
		.getByRole('button', {
			name: 'Сохранить',
		})
		.click();
	await expect(page.getByRole('status').filter({ hasText: 'Изменения сохранены' })).toBeVisible();
	await editPage.getByRole('button', { name: 'Отмена' }).click();
	await expect(page).toHaveURL(/\/knowledge$/);

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Тестовый материал: 5 из 5/,
		}),
	).toBeVisible();

	await expect(page.getByText('5/5', { exact: true })).toHaveCount(0);

	// Рейтинг переживает reload
	await page.reload();

	await expect(
		page.getByRole('img', {
			name: /Рейтинг Тестовый материал: 5 из 5/,
		}),
	).toBeVisible();

	// Отключаем использование записи агентом
	await page
		.locator('label.checkbox')
		.filter({
			hasText: 'Использовать в ответах',
		})
		.click();

	await expect(
		page.getByRole('checkbox', {
			name: 'Использовать в ответах',
		}),
	).not.toBeChecked();

	await page.reload();

	await expect(
		page.getByRole('checkbox', {
			name: 'Использовать в ответах',
		}),
	).not.toBeChecked();

	const controls = page.getByRole('region', {
		name: 'Управление базой знаний',
	});

	// Фильтры
await controls
	.getByRole('button', {
		name: /^Фильтры/,
	})
	.click();

const filtersDropdown = page.locator('.knowledge-page__dropdown--filters');

await expect(filtersDropdown).toBeVisible();

const ratingSelect = filtersDropdown.getByRole('button', { name: 'Рейтинг' });
const sourceSelect = filtersDropdown.getByRole('button', { name: 'Источник' });
const approachSelect = filtersDropdown.getByRole('button', { name: 'Подход' });
const activeSelect = filtersDropdown.getByRole('button', { name: 'Использование' });

await selectCustomOption(page, ratingSelect, '4 и выше');
await expect(ratingSelect).toContainText('4 и выше');

await selectCustomOption(page, sourceSelect, 'Вручную');
await expect(sourceSelect).toContainText('Вручную');

await selectCustomOption(page, approachSelect, 'Интервью');
await expect(approachSelect).toContainText('Интервью');

await selectCustomOption(page, activeSelect, 'Отключены');
await expect(activeSelect).toContainText('Отключены');

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

	// Сортировка
	await controls
		.getByRole('button', {
			name: 'Сортировка',
		})
		.click();

	const sortDropdown = page.locator('.knowledge-page__dropdown--sort');

	await expect(sortDropdown).toBeVisible();

	await sortDropdown
	.getByRole('button', { name: 'Рейтинг: высокий' })
	.click();

await expect(sortDropdown).not.toBeVisible();

await expect
	.poll(() => new URL(page.url()).searchParams.get('sort'))
	.toBe('rating_desc');

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

	// Сбрасываем только фильтры
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

test('file picker accepts drag and drop without overlay text collisions', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/knowledge');
	await page.getByRole('button', { name: 'Добавить данные' }).click();

	await expect(page).toHaveURL(/\/knowledge\/new$/);
	const editor = page.getByRole('region', { name: 'Добавить данные' });
	const dropZone = editor.locator('.knowledge-edit-modal__file-drop-zone');
	const dataTransfer = await page.evaluateHandle(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(['Текст из перетаскивания'], 'dropped.txt', { type: 'text/plain' }));
		return transfer;
	});

	await dropZone.dispatchEvent('dragenter', { dataTransfer });
	await dropZone.dispatchEvent('dragover', { dataTransfer });

	await expect(editor.getByRole('button', { name: 'Отпустите файл' })).toBeVisible();
	await expect(dropZone.locator('.drop-zone__overlay')).toHaveCount(0);

	await dropZone.dispatchEvent('drop', { dataTransfer });

	await expect(editor.getByRole('button', { name: 'Выбрать файл' })).toBeVisible();
	await expect(editor.getByLabel('Название')).toHaveValue('dropped.txt');
	await expect(editor.getByLabel('Содержимое')).toHaveValue('Текст из перетаскивания');
	await expect(editor.getByRole('button', { name: 'Убрать файл dropped.txt' })).toBeVisible();

	await dataTransfer.dispose();
});

test('agent can browse and search the current user knowledge through chat', async ({ page }) => {
	await installMockApi(page);

	await page.goto('/knowledge');

	await page.getByRole('button', { name: 'Добавить данные' }).click();

	await expect(page).toHaveURL(/\/knowledge\/new$/);
	const editor = page.getByRole('region', { name: 'Добавить данные' });

	await editor.getByLabel('Название').fill('Facebook Hooks');

	await editor.getByLabel('Содержимое').fill('Для health-офферов используем curiosity angle');

	await editor.getByRole('button', { name: 'Добавить данные' }).click();
	await expect(page).toHaveURL(/\/knowledge\/k1$/);

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
