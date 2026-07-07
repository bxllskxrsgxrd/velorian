import React, { useState } from 'react';
import { PromptBar } from '../components/PromptBar/PromptBar';
import { DropZone } from '../components/ui/DragAndDrop/DropZone';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import '../scss/default/_index.scss';
import './_homePage.scss';

export function HomePage() {
	const [value, setValue] = useState('');
	const [isSubmit, setIsSubmit] = useState(false);

	const { isDragging, files, handleDragOver, handleDragLeave, handleDrop, removeFile, clearFiles } = useDragAndDrop();

	// ОТПРАВЛЕНИЕ ЗАПРОСА \\
	function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setValue(e.currentTarget.value);
	}

	async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
		if (isSubmit) return;

		e.preventDefault();
		e.stopPropagation();

		const prompt = value.trim();

		if (!prompt && files.length === 0) return;

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

		try {
			setIsSubmit(true);

			const response = await fetch('http://localhost:8000/generate', {
				method: 'POST',
				body: formData,
			});

			const dataResponse = await response.json();

			console.log(`User: ${prompt}\n\nGrok: ${dataResponse.response}`);

			setValue('');
			clearFiles();
		} catch (error) {
			console.error(`Ошибка запроса: ${error}`);
		} finally {
			setIsSubmit(false);
		}
	}
	return (
		<DropZone isDragging={isDragging} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
			<div className="home-page">
				<h1 className="home-page__heading">Введи запрос</h1>
				<PromptBar
					value={value}
					files={files}
					isSubmit={isSubmit}
					onChange={handleChange}
					onSubmit={handleSubmit}
					onRemoveFile={removeFile}
				/>
			</div>
		</DropZone>
	);
}
