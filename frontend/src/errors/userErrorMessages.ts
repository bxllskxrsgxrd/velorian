const ERROR_MESSAGES: Record<string, string> = {
	AUTH_REQUIRED: 'Войдите в аккаунт, чтобы продолжить.',
	INVALID_SESSION: 'Сессия завершилась. Войдите снова.',
	INVALID_CREDENTIALS: 'Неверный email или пароль.',
	FORBIDDEN: 'Недостаточно прав для этого действия.',
	CSRF_INVALID: 'Защитная сессия устарела. Повторите действие.',
	VALIDATION_ERROR: 'Проверьте введённые данные.',
	MESSAGE_TOO_LARGE: 'Сообщение слишком большое. Добавьте текст как файл.',
	FILE_TOO_LARGE: 'Файл превышает допустимый размер.',
	FILES_TOO_LARGE: 'Общий размер файлов превышает допустимый лимит.',
	TOO_MANY_FILES: 'Прикреплено слишком много файлов.',
	UNSUPPORTED_FILE_TYPE: 'Этот формат файла не поддерживается.',
	FILE_PROCESSING_FAILED: 'Не удалось обработать файл. Проверьте его содержимое.',
	RATE_LIMITED: 'Слишком много запросов. Подождите немного и повторите.',
	AI_RATE_LIMITED: 'AI-сервис перегружен. Попробуйте немного позже.',
	AI_TIMEOUT: 'AI-сервис не успел ответить. Повторите запрос.',
	AI_UNAVAILABLE: 'Не удалось подключиться к AI-сервису. Повторите через несколько секунд.',
	AI_SERVICE_ERROR: 'AI-сервис временно недоступен. Повторите через несколько секунд.',
	AI_MODEL_UNAVAILABLE: 'Выбранная AI-модель сейчас недоступна.',
	AI_EMPTY_RESPONSE: 'AI-сервис вернул пустой ответ. Повторите запрос.',
	DATABASE_UNAVAILABLE: 'Сервис временно недоступен. Попробуйте позже.',
	INTERNAL_ERROR: 'Произошла внутренняя ошибка. Попробуйте повторить действие.',
	BACKEND_UNAVAILABLE: 'Не удалось связаться с сервером. Проверяем соединение…',
	NETWORK_ERROR: 'Соединение с сервером потеряно.',
	REQUEST_TIMEOUT: 'Сервер не ответил вовремя. Повторите действие.',
	MALFORMED_RESPONSE: 'Сервер вернул некорректный ответ. Повторите запрос.',
	STREAM_UNAVAILABLE: 'Потоковая передача ответа недоступна в этом браузере.',
};

export function getUserErrorMessage(code: string, status = 0) {
	if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
	if (status === 400 || status === 422) return 'Проверьте корректность введённых данных.';
	if (status === 401) return ERROR_MESSAGES.AUTH_REQUIRED;
	if (status === 403) return ERROR_MESSAGES.FORBIDDEN;
	if (status === 413) return ERROR_MESSAGES.FILE_TOO_LARGE;
	if (status === 429) return ERROR_MESSAGES.RATE_LIMITED;
	if (status >= 500) return 'Не удалось получить ответ от сервера. Попробуйте повторить запрос через несколько секунд.';
	return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
