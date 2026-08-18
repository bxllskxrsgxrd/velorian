import type { ChatMessage } from '../types/chat';

type ChatResponse = {
	response: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export async function sendChatMessage(messages: ChatMessage[], files: File[], signal?: AbortSignal): Promise<ChatResponse> {
	const formData = new FormData();

	formData.append(
		'messages',
		JSON.stringify(
			messages
				.filter((message) => message.content.trim())
				.map(({ role, content }) => ({ role, content })),
		),
	);

	files.forEach((file) => {
		formData.append('files', file);
	});

	const response = await fetch(`${API_BASE_URL}/generate`, {
		method: 'POST',
		body: formData,
		signal,
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => null);

		const errorMessage = errorData?.detail || `Ошибка сервера: ${response.status}`;

		throw new Error(errorMessage);
	}

	const data: unknown = await response.json();

	if (
		typeof data !== 'object' ||
		data === null ||
		!('response' in data) ||
		typeof data.response !== 'string'
	) {
		throw new Error('Сервер вернул некорректный ответ');
	}

	return { response: data.response };
}
