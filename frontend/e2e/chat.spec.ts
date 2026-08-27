import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('new chat stays virtual until one guarded first send', async ({ page }) => {
	const api = await installMockApi(page);
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Черновик старого чата');
	await page.getByRole('button', { name: 'Новый чат' }).click();
	await expect(page).toHaveURL(/\/chat\/new$/);
	await expect(page.getByRole('textbox', { name: 'Введите запрос' })).toHaveValue('');
	expect(api.getConversationCreateCount()).toBe(0);
	expect(api.getConversationCount()).toBe(1);

	await page.reload();
	await expect(page).toHaveURL(/\/chat\/new$/);
	expect(api.getConversationCreateCount()).toBe(0);
	const textarea = page.getByRole('textbox', { name: 'Введите запрос' });
	await textarea.evaluate((element) => {
		const transfer = new DataTransfer();
		transfer.setData('text/plain', `Большая вставка\n${'данные '.repeat(13_000)}`);
		element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
	});
	await expect(page.locator('.prompt-bar__attachments-item')).toHaveCount(1);
	expect(api.getConversationCreateCount()).toBe(0);

	await textarea.fill('Первый запрос');
	await textarea.evaluate((element) => {
		element.form?.requestSubmit();
		element.form?.requestSubmit();
	});
	await expect(page).toHaveURL(/\/chat\/c2$/);
	await expect(page.getByText('Ответ агента')).toBeVisible();
	expect(api.getConversationCreateCount()).toBe(1);
	expect(api.getConversationCount()).toBe(2);
});

test('creates a chat, sends a message and rates the answer', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Новый чат' }).click();
	await page.getByRole('textbox', { name: 'Введите запрос' }).fill('Тестовый запрос');
	await page.getByRole('button', { name: 'Отправить сообщение' }).click();
	await expect(page.getByText('Ответ агента')).toBeVisible();
	await page.getByRole('button', { name: 'Поставить рейтинг 5 из 5' }).click();
	await expect(page.getByRole('button', { name: 'Поставить рейтинг 5 из 5' })).toHaveAttribute('aria-pressed', 'true');
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

test('file picker accepts 10 attachments and reports the 11th with a specific error', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	const chooseFiles = async (names: string[]) => {
		await page.getByLabel('Открыть меню действий').click();
		const chooserPromise = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Прикрепить фото и файлы' }).click();
		const chooser = await chooserPromise;
		await chooser.setFiles(names.map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })));
	};

	await chooseFiles(Array.from({ length: 10 }, (_, index) => `file-${index}.txt`));
	await expect(page.locator('.prompt-bar__attachments-item')).toHaveCount(10);
	await expect(page.locator('.prompt-bar__error')).toHaveCount(0);

	await chooseFiles(['file-10.txt']);
	const validation = page.locator('.prompt-bar__error');
	await expect(validation).toContainText('Слишком много файлов');
	await expect(validation).toContainText('не более 10 файлов');
	await expect(validation).not.toContainText('Непредвиденная ошибка');
	await expect(page.locator('.prompt-bar__attachments-item')).toHaveCount(10);
});

test('drag-and-drop and automatic large paste use the same cumulative attachment limit', async ({ page }) => {
	await installMockApi(page);
	await page.goto('/');
	await page.locator('.drop-zone').evaluate((element) => {
		const transfer = new DataTransfer();
		for (let index = 0; index < 9; index += 1) transfer.items.add(new File([`drop-${index}`], `drop-${index}.txt`, { type: 'text/plain' }));
		element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
	});
	await expect(page.locator('.prompt-bar__attachments-item')).toHaveCount(9);

	const textarea = page.getByRole('textbox', { name: 'Введите запрос' });
	await textarea.evaluate((element) => {
		const transfer = new DataTransfer();
		transfer.setData('text/plain', `paste-one\n${'данные '.repeat(13_000)}`);
		element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
	});
	await expect(page.locator('.prompt-bar__attachments-item')).toHaveCount(10);

	await textarea.evaluate((element) => {
		const transfer = new DataTransfer();
		transfer.setData('text/plain', `paste-two\n${'данные '.repeat(13_000)}`);
		element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
	});
	await expect(page.locator('.prompt-bar__error')).toContainText('Слишком много файлов');
	await expect(page.locator('.prompt-bar__attachments-item')).toHaveCount(10);
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

test('reload keeps the old chat selected from the URL', async ({ page }) => {
	await installMockApi(page, { multipleChats: true });
	await page.goto('/chat/chat-a');
	await expect(page).toHaveURL(/\/chat\/chat-a$/);
	await expect(page.getByText('Сообщения из Chat A')).toBeVisible();
	await expect(page.getByText('Сообщения из Chat B')).toHaveCount(0);

	await page.reload();

	await expect(page).toHaveURL(/\/chat\/chat-a$/);
	await expect(page.getByText('Сообщения из Chat A')).toBeVisible();
	await expect(page.locator('.chat-sidebar__item--active .chat-sidebar__select')).toHaveText('Chat A');
});

test('direct old-chat URL and browser back/forward restore the matching messages', async ({ page }) => {
	await installMockApi(page, { multipleChats: true });
	await page.goto('/chat/chat-a');
	await expect(page.getByText('Сообщения из Chat A')).toBeVisible();

	await page.getByRole('button', { name: 'Chat B', exact: true }).click();
	await expect(page).toHaveURL(/\/chat\/chat-b$/);
	await expect(page.getByText('Сообщения из Chat B')).toBeVisible();

	await page.goBack();
	await expect(page).toHaveURL(/\/chat\/chat-a$/);
	await expect(page.getByText('Сообщения из Chat A')).toBeVisible();

	await page.goForward();
	await expect(page).toHaveURL(/\/chat\/chat-b$/);
	await expect(page.getByText('Сообщения из Chat B')).toBeVisible();
});

test('an unknown chat URL shows not found without opening the newest chat', async ({ page }) => {
	await installMockApi(page, { multipleChats: true });
	await page.goto('/chat/missing');
	await expect(page.getByRole('alert')).toContainText('Чат не найден');
	await expect(page).toHaveURL(/\/chat\/missing$/);
	await expect(page.getByText('Сообщения из Chat B')).toHaveCount(0);
});

test('deleting the active chat applies the fallback only after deletion', async ({ page }) => {
	await installMockApi(page, { multipleChats: true });
	await page.goto('/chat/chat-a');
	await expect(page.getByText('Сообщения из Chat A')).toBeVisible();
	await page.getByRole('button', { name: 'Действия с чатом «Chat A»' }).click();
	await page.getByRole('button', { name: 'Удалить', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
	await expect(page).toHaveURL(/\/chat\/chat-b$/);
	await expect(page.getByText('Сообщения из Chat B')).toBeVisible();
});
