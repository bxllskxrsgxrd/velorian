const ACTIVITY_LABELS: Record<string, string> = {
	'auth.registered': 'Создана учётная запись',
	'auth.login': 'Выполнен вход',
	'auth.logout': 'Выполнен выход',
	'conversation.created': 'Создан чат',
	'conversation.deleted': 'Удалён чат',
	'conversation.restored': 'Восстановлен чат',
	'file.uploaded': 'Загружен файл',
	'file.generated': 'Создан файл',
	'knowledge.created': 'Создан материал Knowledge',
	'knowledge.file_uploaded': 'Загружен файл Knowledge',
	'knowledge.saved_from_message': 'Ответ сохранён в Knowledge',
	'knowledge.deleted': 'Удалён материал Knowledge',
	'knowledge.restored': 'Восстановлен материал Knowledge',
	'admin.role_changed': 'Изменена роль',
};

const RESOURCE_LABELS: Record<string, string> = {
	user: 'Учётная запись',
	conversation: 'Чат',
	message: 'Сообщение',
	attachment: 'Файл',
	knowledge_item: 'Knowledge',
	role_change_audit: 'Роль пользователя',
};

export const ACTIVITY_EVENT_OPTIONS = Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }));

export function activityEventLabel(eventType: string) {
	return ACTIVITY_LABELS[eventType] ?? 'Действие пользователя';
}

export function activityResourceLabel(resourceType: string) {
	return RESOURCE_LABELS[resourceType] ?? resourceType;
}
