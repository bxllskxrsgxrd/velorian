import { useEffect, useRef, useState } from 'react';

type UseTypewriterProps = {
	text: string;
	messageId: string;
	enabled?: boolean;
	charsPerSecond?: number;
};

export function useTypewriter({ text, messageId, enabled = true, charsPerSecond = 50 }: UseTypewriterProps) {
	const [visibleLength, setVisibleLength] = useState(enabled ? 0 : text.length);

	const textRef = useRef(text);

	useEffect(() => {
		textRef.current = text;

		if (!enabled) {
			setVisibleLength(text.length);
		}
	}, [text, enabled]);

	useEffect(() => {
		setVisibleLength(enabled ? 0 : textRef.current.length);
	}, [messageId, enabled]);

	useEffect(() => {
		if (!enabled) return;

		let animationFrameId: number;
		let previousTime = performance.now();
		let accumulatedCharacters = 0;

		const animate = (currentTime: number) => {
			const deltaTime = currentTime - previousTime;

			previousTime = currentTime;

			accumulatedCharacters += (deltaTime / 1000) * charsPerSecond;

			const charactersToAdd = Math.floor(accumulatedCharacters);

			if (charactersToAdd > 0) {
				accumulatedCharacters -= charactersToAdd;

				setVisibleLength((currentLength) => {
					return Math.min(currentLength + charactersToAdd, textRef.current.length);
				});
			}

			animationFrameId = requestAnimationFrame(animate);
		};

		animationFrameId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [messageId, enabled, charsPerSecond]);

	const safeVisibleLength = Math.min(visibleLength, text.length);

	return {
		displayedText: text.slice(0, safeVisibleLength),
		isTyping: enabled && safeVisibleLength < text.length,
	};
}
