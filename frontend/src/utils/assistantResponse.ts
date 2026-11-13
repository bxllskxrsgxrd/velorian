export type AssistantResponseParts = {
	title: string;
	content: string;
};

function cleanHeadingTitle(value: string) {
	let title = value.trim().replace(/\s+#+\s*$/, '');
	for (const marker of ['**', '__', '~~', '`']) {
		if (title.startsWith(marker) && title.endsWith(marker) && title.length > marker.length * 2) {
			title = title.slice(marker.length, -marker.length).trim();
		}
	}
	return title;
}

function headingTitle(line: string, allowOrderedMarker = true): string | null {
	if (allowOrderedMarker) {
		const ordered = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
		if (ordered) return headingTitle(ordered[1], false);
	}
	const atx = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
	if (atx) return cleanHeadingTitle(atx[1]);
	const strong = line.match(/^\s*(?:\*\*(.+?)\*\*|__(.+?)__)\s*$/);
	if (strong) return cleanHeadingTitle(strong[1] ?? strong[2]);
	return null;
}

function fallbackTitle(line: string) {
	return line.trim().replace(/^#+\s*/, '').slice(0, 255) || 'Ответ ассистента';
}

export function splitAssistantResponse(value: string): AssistantResponseParts {
	const lines = value.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
	const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
	if (firstContentIndex < 0) return { title: 'Ответ ассистента', content: value };

	const firstLine = lines[firstContentIndex].replace(/[\r\n]+$/, '');
	const heading = headingTitle(firstLine);
	if (!heading) return { title: fallbackTitle(firstLine), content: value };

	const title = heading.slice(0, 255) || 'Ответ ассистента';
	let bodyIndex = firstContentIndex + 1;
	if (bodyIndex < lines.length && !lines[bodyIndex].trim()) bodyIndex += 1;
	return { title, content: lines.slice(bodyIndex).join('') };
}
