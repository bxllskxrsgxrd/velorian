import React, { useState } from 'react';
import { PromptBar } from '../components/PromptBar/PromptBar';
import '../scss/default/_index.scss';
import './_homePage.scss';

export function HomePage() {
	const [value, setValue] = useState('');
	const [isDragging, setIsDargging] = useState(false);
	const [files, setFiles] = useState<File[]>([]);

	// функция переноса файла
	function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();

		setIsDargging(true);
	}

	function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();

		const currentTarget = e.currentTarget;
		const relatedTarget = (e.relatedTarget as Node) || null;

		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
			setIsDargging(false);
		}
	}

	function handleDrop(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();

		setIsDargging(false);

		
	}

	// ОТПРАВЛЕНИЕ ЗАПРОСА \\
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
		<div className="home-page" onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
			{isDragging && (
				<div className="home-page__drop-overlay">
					<div className="home-page__drop-overlay__content">Дропай деньги</div>
				</div>
			)}
			<h1 className="home-page__heading">Введи запрос</h1>
			<PromptBar value={value} onChange={handleChange} onSubmit={handleSubmit} />
		</div>
	);
}
