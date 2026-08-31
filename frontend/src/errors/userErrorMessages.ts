import type { ChatMessageError } from '../types/chat';
import { getAttachmentLimits } from '../constants/attachmentLimits';
import { formatFileSize } from '../utils/formatFileSize';

type ErrorDefinition = Pick<ChatMessageError, 'title' | 'description' | 'retryable'>;

function formatLimit(bytes: number): string {
	return formatFileSize(bytes).replace('.0 ', ' ');
}

const ERROR_MESSAGES: Record<string, ErrorDefinition> = {
	AUTH_REQUIRED: { title: 'Требуется вход', description: 'Войдите в аккаунт, чтобы продолжить.', retryable: false },
	INVALID_SESSION: { title: 'Сессия завершилась', description: 'Войдите в аккаунт снова.', retryable: false },
	INVALID_CREDENTIALS: { title: 'Не удалось войти', description: 'Проверьте email и пароль.', retryable: false },
	FORBIDDEN: { title: 'Действие недоступно', description: 'У вас недостаточно прав для этого действия.', retryable: false },
	CSRF_INVALID: { title: 'Защитная сессия устарела', description: 'Обновите страницу и повторите действие.', retryable: false },
	VALIDATION_ERROR: { title: 'Проверьте данные', description: 'Исправьте отмеченные поля и повторите действие.', retryable: false },
	FILTER_ALREADY_EXISTS: { title: 'Фильтр уже существует', description: 'Фильтр с таким названием уже существует.', retryable: false },
	FILTER_OPTION_ALREADY_EXISTS: { title: 'Значение уже существует', description: 'Такое значение уже существует в этом фильтре.', retryable: false },
	FILTER_OPTION_ALIAS_ALREADY_EXISTS: { title: 'Псевдоним уже существует', description: 'Такой псевдоним уже добавлен к значению.', retryable: false },
	INVALID_FILTER_OPTION: { title: 'Некорректный фильтр', description: 'Выбранное значение не принадлежит указанному фильтру или недоступно.', retryable: false },
	SYSTEM_FILTER_CANNOT_BE_DELETED: { title: 'Системный фильтр', description: 'Системный фильтр удалить нельзя.', retryable: false },
	MESSAGE_TOO_LARGE: { title: 'Сообщение слишком большое', description: 'Добавьте длинный текст как файл и отправьте запрос снова.', retryable: false },
	FILE_TOO_LARGE: { title: 'Файл слишком большой', description: 'Размер одного или нескольких файлов превышает допустимый лимит.', retryable: false },
	FILES_TOO_LARGE: { title: 'Файлы слишком большие', description: 'Общий размер прикреплённых файлов превышает допустимый лимит.', retryable: false },
	TOO_MANY_FILES: { title: 'Слишком много файлов', description: 'Уменьшите количество вложений и повторите отправку.', retryable: false },
	UNSUPPORTED_FILE_TYPE: { title: 'Формат не поддерживается', description: 'Выберите файл поддерживаемого формата.', retryable: false },
	FILE_PROCESSING_FAILED: { title: 'Не удалось обработать файл', description: 'Проверьте содержимое файла или выберите другой файл.', retryable: false },
	RATE_LIMITED: { title: 'Слишком много запросов', description: 'Подождите немного и попробуйте снова.', retryable: true },
	AI_RATE_LIMITED: { title: 'Слишком много запросов', description: 'AI-сервис перегружен. Подождите немного и попробуйте снова.', retryable: true },
	AI_TIMEOUT: { title: 'Ответ занял слишком много времени', description: 'Сервер не успел завершить запрос. Попробуйте повторить его.', retryable: true },
	REQUEST_TIMEOUT: { title: 'Ответ занял слишком много времени', description: 'Сервер не успел завершить запрос. Попробуйте повторить его.', retryable: true },
	AI_UNAVAILABLE: { title: 'Не удалось получить ответ', description: 'Сервис генерации временно недоступен. Попробуйте повторить запрос через несколько секунд.', retryable: true },
	AI_SERVICE_ERROR: { title: 'Не удалось получить ответ', description: 'AI-сервис временно недоступен. Попробуйте повторить запрос через несколько секунд.', retryable: true },
	AI_PROVIDER_UNAVAILABLE: { title: 'Не удалось получить ответ', description: 'Сервис генерации временно недоступен. Попробуйте повторить запрос через несколько секунд.', retryable: true },
	AI_MODEL_UNAVAILABLE: { title: 'Модель временно недоступна', description: 'Попробуйте отправить запрос ещё раз через несколько секунд.', retryable: true },
	AI_EMPTY_RESPONSE: { title: 'Не удалось получить ответ', description: 'Сервис вернул пустой ответ. Попробуйте повторить запрос.', retryable: true },
	DATABASE_UNAVAILABLE: { title: 'Сервис временно недоступен', description: 'Не удалось обратиться к хранилищу данных. Попробуйте позже.', retryable: true },
	INTERNAL_ERROR: { title: 'Не удалось выполнить запрос', description: 'Произошла непредвиденная ошибка. Попробуйте повторить запрос.', retryable: true },
	BACKEND_UNAVAILABLE: { title: 'Не удалось получить ответ от сервера', description: 'Сервис временно недоступен. Попробуйте отправить сообщение ещё раз через несколько секунд.', retryable: true },
	NETWORK_ERROR: { title: 'Нет соединения', description: 'Проверьте подключение к интернету. После восстановления соединения можно повторить запрос.', retryable: true },
	MALFORMED_RESPONSE: { title: 'Некорректный ответ сервера', description: 'Сервер вернул данные в неизвестном формате. Попробуйте повторить запрос.', retryable: true },
	STREAM_UNAVAILABLE: { title: 'Ответ недоступен', description: 'Браузер не поддерживает потоковую передачу ответа.', retryable: false },
	HISTORICAL_MESSAGE_ERROR: { title: 'Не удалось получить ответ', description: 'При выполнении запроса произошла ошибка. Попробуйте повторить его.', retryable: true },
	AI_REQUEST_INTERRUPTED: { title: 'Не удалось получить ответ', description: 'При выполнении запроса произошла ошибка. Попробуйте повторить его.', retryable: true },
};

function attachmentErrorDefinition(code: string): ErrorDefinition | undefined {
	const limits = getAttachmentLimits();
	if (code === 'ATTACHMENT_COUNT_LIMIT_EXCEEDED' || code === 'TOO_MANY_FILES') return {
		title: 'Слишком много файлов',
		description: `Можно прикрепить не более ${limits.maxAttachments} файлов к одному сообщению. Удалите лишние файлы и попробуйте снова.`,
		retryable: false,
	};
	if (code === 'FILE_SIZE_LIMIT_EXCEEDED' || code === 'FILE_TOO_LARGE') return {
		title: 'Файл слишком большой',
		description: `Размер одного файла не должен превышать ${formatLimit(limits.maxFileSize)}.`,
		retryable: false,
	};
	if (code === 'ATTACHMENTS_TOTAL_SIZE_LIMIT_EXCEEDED' || code === 'FILES_TOO_LARGE') return {
		title: 'Превышен общий размер вложений',
		description: `Общий размер файлов в одном сообщении не должен превышать ${formatLimit(limits.maxTotalSize)}.`,
		retryable: false,
	};
}

function fallbackForStatus(status: number): ErrorDefinition {
	if (status === 400 || status === 422) return ERROR_MESSAGES.VALIDATION_ERROR;
	if (status === 401) return ERROR_MESSAGES.AUTH_REQUIRED;
	if (status === 403) return ERROR_MESSAGES.FORBIDDEN;
	if (status === 413) return ERROR_MESSAGES.FILE_TOO_LARGE;
	if (status === 429) return ERROR_MESSAGES.RATE_LIMITED;
	if (status >= 500) return ERROR_MESSAGES.BACKEND_UNAVAILABLE;
	return { title: 'Не удалось выполнить запрос', description: 'Произошла непредвиденная ошибка. Попробуйте повторить запрос.', retryable: true };
}

export function getUserFacingError(code: string, status = 0, requestId?: string): ChatMessageError {
	return { code, ...(attachmentErrorDefinition(code) ?? ERROR_MESSAGES[code] ?? fallbackForStatus(status)), ...(requestId ? { requestId } : {}) };
}

export function getUserErrorMessage(code: string, status = 0) {
	return getUserFacingError(code, status).description;
}
