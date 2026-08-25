export function createPastedTextFile(content: string, now = new Date()) {
	const timestamp = now.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');
	return new File([content], `pasted-text-${timestamp}.txt`, {
		type: 'text/plain;charset=utf-8',
		lastModified: now.getTime(),
	});
}
