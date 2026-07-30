type UserMessageContentProps = {
	content: string;
};

export function UserMessageContent({ content }: UserMessageContentProps) {
	return <div>{content}</div>;
}
