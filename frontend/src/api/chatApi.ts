export async function sendChatMessage(prompt: string, files: File[]) {
	const formData = new FormData();

	formData.append(
		'messages',
		JSON.stringify([
			{
				role: 'user',
				content: prompt,
			},
		]),
	);

	files.forEach((file) => {
		formData.append('files', file);
	});

	const response = await fetch('http://localhost:8000/generate', {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		throw new Error('Ошибка запроса');
	}

	return response.json();
}
