import math
import re
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import DocumentChunk


TOKEN_PATTERN = re.compile(r"[\w-]+", re.UNICODE)


def estimate_tokens(text: str) -> int:
	# Консервативная оценка для смешанного русского/английского текста.
	return max(1, math.ceil(len(text) / 2)) if text else 0


def chunk_text(text: str, chunk_size: int = 3500, overlap: int = 350) -> list[str]:
	cleaned = text.replace("\x00", "").strip()
	if not cleaned:
		return []

	chunks: list[str] = []
	start = 0
	while start < len(cleaned):
		end = min(len(cleaned), start + chunk_size)
		if end < len(cleaned):
			paragraph_break = cleaned.rfind("\n", start + chunk_size // 2, end)
			space_break = cleaned.rfind(" ", start + chunk_size // 2, end)
			end = max(paragraph_break, space_break, start + chunk_size // 2)
		chunks.append(cleaned[start:end].strip())
		if end >= len(cleaned):
			break
		start = max(start + 1, end - overlap)
	return [chunk for chunk in chunks if chunk]


def _terms(text: str) -> list[str]:
	return [term.lower() for term in TOKEN_PATTERN.findall(text) if len(term) > 1]


def retrieve_chunks(db: Session, conversation_id: str, query: str, limit: int = 6) -> list[DocumentChunk]:
	chunks = list(
		db.scalars(
			select(DocumentChunk)
			.where(DocumentChunk.conversation_id == conversation_id)
			.order_by(DocumentChunk.id.desc())
			.limit(600)
		)
	)
	if not chunks:
		return []

	query_terms = _terms(query)
	if not query_terms:
		return list(reversed(chunks[:limit]))

	document_terms = [_terms(chunk.content) for chunk in chunks]
	document_count = len(chunks)
	document_frequency = Counter(term for terms in document_terms for term in set(terms))

	scored: list[tuple[float, DocumentChunk]] = []
	for chunk, terms in zip(chunks, document_terms, strict=True):
		counts = Counter(terms)
		length_normalizer = max(1.0, len(terms) / 220)
		score = 0.0
		for term in query_terms:
			if counts[term]:
				idf = math.log((document_count + 1) / (document_frequency[term] + 1)) + 1
				score += (1 + math.log(counts[term])) * idf / length_normalizer
		if score > 0:
			scored.append((score, chunk))

	if not scored:
		return list(reversed(chunks[: min(2, limit)]))

	scored.sort(key=lambda item: item[0], reverse=True)
	return [chunk for _, chunk in scored[:limit]]
