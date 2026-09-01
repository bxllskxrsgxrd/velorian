import { Children, isValidElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createStore, useStore } from 'zustand';
import { Highlight, Prism, type PrismTheme } from 'prism-react-renderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckIcon } from '../icons/AppIcons';
import { CopyIcon } from '../icons/AppIcons';
import { IconButton } from '../ui/IconButton/IconButton';
import './_messageContent.scss';

type AssistantMessageContentProps = { content: string; isStreaming: boolean };

const LANGUAGE_LABELS: Record<string, string> = {
	markup: 'HTML', html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass',
	typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX', javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
	json: 'JSON', markdown: 'Markdown', md: 'Markdown', python: 'Python', py: 'Python', sql: 'SQL',
	bash: 'Bash', shell: 'Shell', sh: 'Shell', xml: 'XML', yaml: 'YAML', yml: 'YAML',
	java: 'Java', kotlin: 'Kotlin', swift: 'Swift', go: 'Go', rust: 'Rust', ruby: 'Ruby', php: 'PHP',
	c: 'C', cpp: 'C++', csharp: 'C#', cs: 'C#', vue: 'Vue', svelte: 'Svelte', text: 'TXT', txt: 'TXT', plaintext: 'TXT',
};

const forestNightTheme: PrismTheme = {
	plain: { color: '#dce9df', backgroundColor: '#111a15' },
	styles: [
		{ types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#73877a', fontStyle: 'italic' } },
		{ types: ['punctuation'], style: { color: '#a8b8ad' } },
		{ types: ['namespace'], style: { opacity: 0.8 } },
		{ types: ['property', 'tag', 'constant', 'symbol', 'deleted'], style: { color: '#ff9c80' } },
		{ types: ['boolean', 'number'], style: { color: '#d3a4ee' } },
		{ types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: '#8be1ad' } },
		{ types: ['operator', 'entity', 'url', 'string-variable'], style: { color: '#8fc7ff' } },
		{ types: ['atrule', 'attr-value', 'function', 'class-name'], style: { color: '#ffd479' } },
		{ types: ['keyword'], style: { color: '#d3a4ee', fontWeight: '600' } },
		{ types: ['regex', 'important', 'variable'], style: { color: '#ffb098' } },
	],
};

function registerLanguageGrammars() {
	if (!Prism.languages.java) Prism.languages.java = Prism.languages.extend('clike', {
		keyword: /\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|module|native|new|package|private|protected|public|record|return|sealed|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|yield)\b/,
		annotation: { pattern: /(^|[^.])@[\w.]+/, lookbehind: true, alias: 'punctuation' },
	});
	if (!Prism.languages.csharp) Prism.languages.csharp = Prism.languages.extend('clike', {
		keyword: /\b(?:abstract|add|alias|as|async|await|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|dynamic|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|from|get|global|goto|if|implicit|in|init|int|interface|internal|into|is|join|let|lock|long|namespace|new|null|object|operator|out|override|params|partial|private|protected|public|readonly|record|ref|remove|required|return|sbyte|sealed|select|set|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|value|var|virtual|void|volatile|when|where|while|with|yield)\b/,
	});
	if (!Prism.languages.ruby) Prism.languages.ruby = Prism.languages.extend('python', {
		keyword: /\b(?:BEGIN|END|alias|and|begin|break|case|class|def|defined\?|do|else|elsif|end|ensure|false|for|if|in|module|next|nil|not|or|redo|rescue|retry|return|self|super|then|true|undef|unless|until|when|while|yield)\b/,
		symbol: /:[a-zA-Z_]\w*[!?=]?/,
	});
	if (!Prism.languages.php) Prism.languages.php = Prism.languages.extend('clike', {
		keyword: /\b(?:abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|enum|eval|exit|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|new|or|print|private|protected|public|readonly|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield)\b/i,
		variable: /\$+(?:\w+|\{[^}]+\})/,
	});
	if (!Prism.languages.scss) Prism.languages.scss = Prism.languages.extend('css', {
		comment: /\/\*[\s\S]*?\*\/|\/\/.*$/m,
		atrule: /@[\w-]+(?:[^;{]|\{(?:[^{}]|\{[^{}]*\})*\})*(?:;|(?=\s*\{))/,
		variable: /\$[-\w]+|--[-\w]+/,
	});
	if (!Prism.languages.bash) Prism.languages.bash = {
		comment: { pattern: /(^|[^"'\\])#.*/, lookbehind: true },
		string: [{ pattern: /"(?:\\[\s\S]|[^"\\])*"/, greedy: true }, { pattern: /'(?:[^']*)'/, greedy: true }],
		variable: /\$(?:[a-zA-Z_]\w*|\{[^}]+\}|[?#*@!$0-9_-])+/,
		keyword: /\b(?:case|coproc|do|done|elif|else|esac|fi|for|function|if|in|select|then|time|until|while)\b/,
		builtin: /\b(?:alias|bg|bind|break|builtin|cd|command|declare|echo|enable|eval|exec|exit|export|fc|fg|getopts|hash|help|history|jobs|kill|let|local|logout|mapfile|printf|pwd|read|readonly|return|set|shift|shopt|source|test|times|trap|type|typeset|ulimit|umask|unalias|unset|wait)\b/,
		function: /\b[a-zA-Z_]\w*(?=\s*\(\s*\))/,
		operator: /&&?|\|\|?|;;|[<>]=?|[=!]=?/,
		punctuation: /[{}[\]();]/,
	};
	Prism.languages.cs = Prism.languages.csharp;
	Prism.languages.sh = Prism.languages.bash;
	Prism.languages.shell = Prism.languages.bash;
	Prism.languages.vue = Prism.languages.markup;
	Prism.languages.svelte = Prism.languages.markup;
}

registerLanguageGrammars();

function nodeText(node: ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(nodeText).join('');
	if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
	return '';
}

function detectLanguage(code: string) {
	const trimmed = code.trim();
	if (/^<[!?/]?[a-z][\s\S]*>/i.test(trimmed)) return 'markup';
	if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
		try { JSON.parse(trimmed); return 'json'; } catch { /* Continue with syntax heuristics. */ }
	}
	if (/\$[\w-]+\s*:|&(?:[:.#]|\[)|@mixin|@include/.test(trimmed)) return 'scss';
	if (/\b(interface|namespace|enum|implements|type)\b|:\s*(string|number|boolean|unknown|never)\b/.test(trimmed)) return 'typescript';
	if (/[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*[\w-]+\s*:/.test(trimmed)) return 'css';
	if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/i.test(trimmed)) return 'sql';
	if (/^(#!.*(?:sh|bash)|\s*(?:npm|pnpm|yarn|git|cd|mkdir)\s)/.test(trimmed)) return 'bash';
	if (/\b(def|from|import|class)\s+[\w.]+|if __name__ ==/.test(trimmed)) return 'python';
	if (/\b(const|let|function|import|export)\b|=>/.test(trimmed)) return 'javascript';
	return 'text';
}

type HighlightedCodeProps = {
	code: string;
	language: string;
	className?: string;
	ariaLabel?: string;
};

export function HighlightedCode({ code, language, className, ariaLabel }: HighlightedCodeProps) {
	const prismLanguage = Prism.languages[language] ? language : detectLanguage(code);
	return (
		<Highlight theme={forestNightTheme} code={code} language={Prism.languages[prismLanguage] ? prismLanguage : 'text'}>
			{({ className: prismClassName, style, tokens, getLineProps, getTokenProps }) => (
				<pre className={[prismClassName, className].filter(Boolean).join(' ')} style={style} aria-label={ariaLabel}>
					<code>{tokens.map((line, lineIndex) => (
						<span {...getLineProps({ line })} key={lineIndex}>
							{line.map((token, tokenIndex) => <span {...getTokenProps({ token })} key={tokenIndex} />)}
							{lineIndex < tokens.length - 1 ? '\n' : null}
						</span>
					))}</code>
				</pre>
			)}
		</Highlight>
	);
}

function getCodeBlockData(children: ReactNode) {
	const codeElement = Children.toArray(children).find((child) => isValidElement<{ className?: string; children?: ReactNode }>(child));
	const code = nodeText(children).replace(/\n$/, '');
	const declared = isValidElement<{ className?: string }>(codeElement)
		? codeElement.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase()
		: undefined;
	const detected = declared || detectLanguage(code);
	const prismLanguage = Prism.languages[detected] ? detected : 'text';
	return { code, language: prismLanguage, label: LANGUAGE_LABELS[detected] || detected.toUpperCase() };
}

function normalizeMarkdown(content: string) {
	return content
		.replace(/```file:[^\n`]*\n[\s\S]*?(?:\n```|$)/gi, 'Формируется файл…')
		.replace(/[\u200B-\u200D\uFEFF]/g, '')
		.replace(/^(\s{0,3}#{1,6})[\t \u00a0\u202f]+/gm, '$1 ')
		.replace(/\n{3,}/g, '\n\n');
}

function sanitizeHeading(value: string) {
	return value
		.replace(/([0-9])\uFE0F?\u20E3/g, '$1.')
		.replace(/\p{Extended_Pictographic}/gu, '')
		.replace(/[\u2600-\u27BF]/g, '')
		.replace(/\uFE0F|\u20E3/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

async function copyToClipboard(value: string) {
	if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
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

function createCopyButtonStore() {
	return createStore<{ copied: boolean; setCopied: (copied: boolean) => void }>((set) => ({
		copied: false,
		setCopied: (copied) => set({ copied }),
	}));
}

function MarkdownCopyButton({ label, getValue }: { label: string; getValue: () => string }) {
	const store = useMemo(() => createCopyButtonStore(), []);
	const copied = useStore(store, (state) => state.copied);
	const setCopied = useStore(store, (state) => state.setCopied);
	const timerRef = useRef<number | null>(null);
	useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, []);

	async function handleCopy() {
		try {
			await copyToClipboard(getValue());
			setCopied(true);
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => setCopied(false), 1800);
		} catch { setCopied(false); }
	}

	const accessibleLabel = copied ? 'Скопировано' : `Копировать ${label}`;
	return (
		<IconButton className="message__markdown-copy" onClick={() => void handleCopy()} aria-label={accessibleLabel} title={accessibleLabel}>
			{copied ? <CheckIcon /> : <CopyIcon />}
		</IconButton>
	);
}

function MarkdownPre({ children }: { children?: ReactNode }) {
	const { code, language, label } = getCodeBlockData(children);
	return (
		<div className="message__markdown-block message__markdown-code-block">
			<div className="message__markdown-toolbar"><span>{label}</span><MarkdownCopyButton label={label} getValue={() => code} /></div>
			<HighlightedCode code={code} language={language} ariaLabel={`Код ${label}`} />
		</div>
	);
}

function MarkdownTable({ children }: { children?: ReactNode }) {
	const tableRef = useRef<HTMLTableElement>(null);
	function tableText() {
		if (!tableRef.current) return '';
		return Array.from(tableRef.current.rows)
			.map((row) => Array.from(row.cells).map((cell) => (cell.innerText || cell.textContent || '').trim()).join('\t'))
			.join('\n');
	}
	return (
		<div className="message__markdown-block message__markdown-table-block">
			<div className="message__markdown-toolbar"><span>Таблица</span><MarkdownCopyButton label="таблицу" getValue={tableText} /></div>
			<div className="message__markdown-table-scroll"><table ref={tableRef}>{children}</table></div>
		</div>
	);
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
	return function MarkdownHeading({ children }: { children?: ReactNode }) {
		const Heading = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
		return <Heading>{sanitizeHeading(nodeText(children))}</Heading>;
	};
}

export function AssistantMessageContent({ content, isStreaming }: AssistantMessageContentProps) {
	return (
		<div className="message__text message__text--assistant message__markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				skipHtml
				components={{
					a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
					pre: MarkdownPre, table: MarkdownTable,
					h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
				}}
			>
				{normalizeMarkdown(content)}
			</ReactMarkdown>
			{isStreaming && <span className="message__typing-cursor" aria-label="Ответ продолжается" />}
		</div>
	);
}

export default AssistantMessageContent;
