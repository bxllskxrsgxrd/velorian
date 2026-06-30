import React, { useState } from 'react';
import { PromptBar } from '../components/PromptBar/PromptBar';
import '../scss/default/_index.scss';
import './_homePage.scss';

export function HomePage() {
	const [value, setValue] = useState('');

	function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setValue(e.currentTarget.value);
	}

	async function handleSubmit() {
		const prompt = value.trim();

		if (!prompt) return;

		try {
			const response = await fetch('http://localhost:8000/generate', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					messages: [
						{
							role: 'user',
							content: prompt,
						},
					],
				}),
			});

			const data = await response.json();

			console.log(`Grok: ${data.response}`);

			setValue('');
		} catch (error) {
			console.error(`Ошибка запроса: ${error}`);
		}
	}
	return (
		<div className="home-page">
			<h1>Введи запрос</h1>
			<PromptBar value={value} onChange={handleChange} onSubmit={handleSubmit} />
		</div>
	);
}
