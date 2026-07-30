import { useTypewriter } from '../../hooks/useTypeWriter';

type AssistantMessageContentProps = {
	messageId: string;
	content: string;
	shouldAnimate: boolean;
};

export function AssistantMessageContent({ messageId, content, shouldAnimate }: AssistantMessageContentProps) {
	const { displayedText, isTyping } = useTypewriter({
		text: content,
		messageId,
		enabled: shouldAnimate,
		charsPerSecond: 55,
	});

	return (
		<div className="message__text message__text--assistant">
			<span>{displayedText}</span>

			{isTyping && <span className="message__typing-cursor" aria-hidden="true" />}
		</div>
	);
}
