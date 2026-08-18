import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './_messageContent.scss';

type AssistantMessageContentProps = {
	content: string;
	isStreaming: boolean;
};

export function AssistantMessageContent({ content, isStreaming }: AssistantMessageContentProps) {
	return (
		<div className="message__text message__text--assistant message__markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
				}}
			>
				{content}
			</ReactMarkdown>
			{isStreaming && <span className="message__typing-cursor" aria-label="Ответ продолжается" />}
		</div>
	);
}
