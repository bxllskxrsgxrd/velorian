import { useEffect, useRef, useState } from 'react';

type UseTypewriterProps = {
	text: string;
	messageId: string;
	enabled?: boolean;
	charsPerSecond?: number;
};

export function useTypewriter({ text, messageId, enabled = true, charsPerSecond = 50 }: UseTypewriterProps) {
	const [visibleLength, setVisibleLength] = useState(enabled ? 0 : text.length);
	const visibleLengthRef = useRef(visibleLength);

	useEffect(() => {
		if (!enabled || visibleLengthRef.current >= text.length) return;

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

				const nextLength = Math.min(visibleLengthRef.current + charactersToAdd, text.length);

				visibleLengthRef.current = nextLength;
				setVisibleLength(nextLength);
			}

			if (visibleLengthRef.current < text.length) {
				animationFrameId = requestAnimationFrame(animate);
			}
		};

		animationFrameId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(animationFrameId);
		};
	}, [text, messageId, enabled, charsPerSecond]);

	const safeVisibleLength = enabled ? Math.min(visibleLength, text.length) : text.length;

	return {
		displayedText: text.slice(0, safeVisibleLength),
		isTyping: enabled && safeVisibleLength < text.length,
	};
}
