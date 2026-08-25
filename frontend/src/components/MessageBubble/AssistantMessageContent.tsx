import { Children, isValidElement, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyIcon } from '../icons/CopyIcon';
import { IconButton } from '../ui/IconButton/IconButton';
import './_messageContent.scss';

type AssistantMessageContentProps = {
	content: string;
	isStreaming: boolean;
};

const LANGUAGE_LABELS: Record<string, string> = {
	html: 'HTML',
	css: 'CSS',
	scss: 'SCSS',
	sass: 'Sass',
	typescript: 'TypeScript',
	ts: 'TypeScript',
	tsx: 'TSX',
	javascript: 'JavaScript',
	js: 'JavaScript',
	jsx: 'JSX',
	json: 'JSON',
	markdown: 'Markdown',
	md: 'Markdown',
	python: 'Python',
	py: 'Python',
	sql: 'SQL',
	bash: 'Bash',
	shell: 'Shell',
	sh: 'Shell',
	xml: 'XML',
	yaml: 'YAML',
	yml: 'YAML',
	text: 'TXT',
	txt: 'TXT',
	plaintext: 'TXT',
};

function nodeText(node: ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(nodeText).join('');
	if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
	return '';
}

function detectLanguage(code: string) {
	const trimmed = code.trim();
	if (/^<[!?/]?[a-z][\s\S]*>/i.test(trimmed)) return 'HTML';
	const looksLikeJson =
		(trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
	if (looksLikeJson) {
		try {
			JSON.parse(trimmed);
			return 'JSON';
		} catch {
			// Continue with syntax heuristics.
		}
	}
	if (/\$[\w-]+\s*:|&(?:[:.#]|\[)|@mixin|@include/.test(trimmed)) return 'SCSS';
	if (/\b(interface|namespace|enum|implements|type)\b|:\s*(string|number|boolean|unknown|never)\b/.test(trimmed))
		return 'TypeScript';
	if (/[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*[\w-]+\s*:/.test(trimmed)) return 'CSS';
	if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/i.test(trimmed)) return 'SQL';
	if (/^(#!.*(?:sh|bash)|\s*(?:npm|pnpm|yarn|git|cd|mkdir)\s)/.test(trimmed)) return 'Bash';
	if (/\b(def|from|import|class)\s+[\w.]+|if __name__ ==/.test(trimmed)) return 'Python';
	if (/\b(const|let|function|import|export)\b|=>/.test(trimmed)) return 'JavaScript';
	return 'TXT';
}

function getCodeBlockData(children: ReactNode) {
	const codeElement = Children.toArray(children).find((child) =>
		isValidElement<{ className?: string; children?: ReactNode }>(child),
	);
	const code = nodeText(children).replace(/\n$/, '');
	if (!isValidElement<{ className?: string }>(codeElement)) return { code, language: detectLanguage(code) };
	const languageName = codeElement.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase();
	return { code, language: (languageName && LANGUAGE_LABELS[languageName]) || detectLanguage(code) };
}

async function copyToClipboard(value: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}

	const textarea = document.createElement('textarea');
	textarea.value = value;
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	document.body.append(textarea);
	textarea.select();
	const copied = document.execCommand('copy');
	textarea.remove();
	if (!copied) throw new Error('Clipboard API is unavailable');
}

function MarkdownCopyButton({ label, getValue }: { label: string; getValue: () => string }) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		try {
			await copyToClipboard(getValue());
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1400);
		} catch {
			setCopied(false);
		}
	}

	const accessibleLabel = copied ? 'Скопировано' : `Копировать ${label}`;
	return (
		<IconButton
			className="message__markdown-copy"
			onClick={() => void handleCopy()}
			aria-label={accessibleLabel}
			title={accessibleLabel}
		>
			<CopyIcon />
		</IconButton>
	);
}

function MarkdownPre({ children }: { children?: ReactNode }) {
	const { code, language } = getCodeBlockData(children);
	return (
		<div className="message__markdown-block message__markdown-code-block">
			<div className="message__markdown-toolbar">
				<span>{language}</span>
				<MarkdownCopyButton label={language} getValue={() => code} />
			</div>
			<pre>{children}</pre>
		</div>
	);
}

function MarkdownTable({ children }: { children?: ReactNode }) {
	const tableRef = useRef<HTMLTableElement>(null);
	function tableText() {
		if (!tableRef.current) return '';
		return Array.from(tableRef.current.rows)
			.map((row) =>
				Array.from(row.cells)
					.map((cell) => (cell.innerText || cell.textContent || '').trim())
					.join('\t'),
			)
			.join('\n');
	}

	return (
		<div className="message__markdown-block message__markdown-table-block">
			<div className="message__markdown-toolbar">
				<span>Таблица</span>
				<MarkdownCopyButton label="таблицу" getValue={tableText} />
			</div>
			<div className="message__markdown-table-scroll">
				<table ref={tableRef}>{children}</table>
			</div>
		</div>
	);
}

export function AssistantMessageContent({ content, isStreaming }: AssistantMessageContentProps) {
	return (
		<div className="message__text message__text--assistant message__markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
					pre: MarkdownPre,
					table: MarkdownTable,
				}}
			>
				{content}
			</ReactMarkdown>
			{isStreaming && <span className="message__typing-cursor" aria-label="Ответ продолжается" />}
		</div>
	);
}
