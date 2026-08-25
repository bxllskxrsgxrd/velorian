const FILE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
	html: 'markup', htm: 'markup', xml: 'xml', css: 'css', scss: 'scss', sass: 'sass',
	js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
	json: 'json', md: 'markdown', py: 'python', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
	yaml: 'yaml', yml: 'yaml', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', go: 'go',
	rs: 'rust', rb: 'ruby', php: 'php', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
	vue: 'vue', svelte: 'svelte',
};

export function getFileCodeLanguage(fileName: string) {
	const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
	return FILE_LANGUAGE_BY_EXTENSION[extension] || 'text';
}
