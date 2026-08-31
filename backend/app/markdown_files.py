import re
from pathlib import Path


INVALID_FILE_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
MARKDOWN_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$")


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
		match = MARKDOWN_HEADING.match(line)
		if match:
			return sanitize_file_stem(match.group(1), fallback)
	for line in content.splitlines():
		plain = re.sub(r"[`#*_~>\[\]{}()]", " ", line)
		plain = re.sub(r"\s+", " ", plain).strip()
		if plain:
			return sanitize_file_stem(" ".join(plain.split()[:8]), fallback)
	return fallback


def unique_markdown_file_name(title: str, existing_names: set[str], fallback: str = "article") -> str:
	stem = sanitize_file_stem(title, fallback)
	existing = {name.casefold() for name in existing_names}
	candidate = f"{stem}.md"
	index = 2
	while candidate.casefold() in existing:
		candidate = f"{stem}-{index}.md"
		index += 1
	return candidate
