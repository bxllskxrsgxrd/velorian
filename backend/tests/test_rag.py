from app.rag import chunk_text, estimate_tokens


def test_chunk_text_keeps_overlap_and_content():
	text = "слово " * 2000
	chunks = chunk_text(text, chunk_size=300, overlap=30)
	assert len(chunks) > 2
	assert all(chunk for chunk in chunks)
	assert all(len(chunk) <= 300 for chunk in chunks)


def test_token_estimate_is_conservative():
	assert estimate_tokens("") == 0
	assert estimate_tokens("Привет, мир!") >= 6
