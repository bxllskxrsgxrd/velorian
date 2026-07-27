import { useEffect, useRef } from 'react';

type UseTypewriterProps = {
	text: string;
	messageId: string;
	enabled?: boolean;
	charsPerSecond?: number;
};

export function useTypeWriter({ text, messageId, enabled = true, charsPerSecond = 20 }: UseTypewriterProps) {
	const [visibleLenght, setVisibleLength] = enabled ? 0 : text.length;

	const textRef = useRef(text);

	useEffect(() => {
		textRef.current = text;

		if (!enabled) {
			setVisibleLength(text.length);
		}
	}, [text, enabled]);

  useEffect(() => {
    setVisibleLength(enabled ? 0 : textRef.current.length);
  }, [enabled, messageId]);

  useEffect(() => { 
    if (!enabled) return;
  }, []);
  

	return {
		text,
		messageId,
		enabled,
		charsPerSecond,
	};
}
