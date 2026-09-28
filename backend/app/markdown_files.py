import re
from pathlib import Path


INVALID_FILE_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
MARKDOWN_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$")
MARKDOWN_STRONG_HEADING = re.compile(r"^\s*(?:\*\*(.+?)\*\*|__(.+?)__)\s*$")
MARKDOWN_ORDERED_HEADING = re.compile(r"^\s*\d+[.)]\s+(.+?)\s*$")


def _heading_title(line: str, allow_ordered_marker: bool = True) -> str | None:
	if allow_ordered_marker and (ordered_match := MARKDOWN_ORDERED_HEADING.match(line)):
		return _heading_title(ordered_match.group(1), allow_ordered_marker=False)
	match = MARKDOWN_HEADING.match(line)
	if match:
		value = re.sub(r"\s+#+\s*$", "", match.group(1)).strip()
	else:
		match = MARKDOWN_STRONG_HEADING.match(line)
		if not match:
			return None
		value = next(group for group in match.groups() if group is not None).strip()
	for opening, closing in (("**", "**"), ("__", "__"), ("`", "`"), ("~~", "~~")):
		if value.startswith(opening) and value.endswith(closing) and len(value) > len(opening) + len(closing):
			value = value[len(opening):-len(closing)].strip()
	return value or None


def sanitize_file_stem(value: str, fallback: str = "document") -> str:
	"""Return a cross-platform-safe Unicode file stem without changing Markdown."""
	stem = Path(value.strip()).stem if value.strip() else ""
	stem = INVALID_FILE_NAME_CHARS.sub("-", stem)
	stem = re.sub(r"\s+", " ", stem).strip(" .-")
	stem = re.sub(r"-{2,}", "-", stem)
	return (stem or fallback)[:100].rstrip(" .-") or fallback


def markdown_file_name(title: str, fallback: str = "document") -> str:
	return f"{sanitize_file_stem(title, fallback)}.md"


def markdown_title(content: str, fallback: str = "article") -> str:
	for line in content.splitlines():
		if title := _heading_title(line):
			return sanitize_file_stem(title, fallback)
	for line in content.splitlines():
		plain = re.sub(r"[`#*_~>\[\]{}()]", " ", line)
		plain = re.sub(r"\s+", " ", plain).strip()
		if plain:
			return sanitize_file_stem(" ".join(plain.split()[:8]), fallback)
	return fallback


def split_markdown_title(content: str, fallback: str = "article") -> tuple[str, str]:
	"""Extract a Markdown heading and remove it from the body when it is the leading title."""
	title = markdown_title(content, fallback)
	lines = content.splitlines(keepends=True)
	first_content_index = next((index for index, line in enumerate(lines) if line.strip()), None)
	if first_content_index is None:
		return title, content
	heading = _heading_title(lines[first_content_index].rstrip("\r\n"))
	if heading is None or sanitize_file_stem(heading, fallback).casefold() != title.casefold():
		return title, content
	body_lines = lines[first_content_index + 1:]
	if body_lines and not body_lines[0].strip():
		body_lines = body_lines[1:]
	return title, "".join(body_lines)


def unique_markdown_file_name(title: str, existing_names: set[str], fallback: str = "article") -> str:
	stem = sanitize_file_stem(title, fallback)
	existing = {name.casefold() for name in existing_names}
	candidate = f"{stem}.md"
	index = 2
	while candidate.casefold() in existing:
		candidate = f"{stem}-{index}.md"
		index += 1
	return candidate
