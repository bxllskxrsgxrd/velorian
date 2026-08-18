import base64
import io

from PIL import Image

from app.file_processing import extract_text, image_to_data_url


def test_image_is_prepared_as_bounded_jpeg_data_url():
	buffer = io.BytesIO()
	Image.new("RGBA", (120, 80), (20, 90, 60, 120)).save(buffer, format="PNG")
	data_url = image_to_data_url(buffer.getvalue())
	assert data_url.startswith("data:image/jpeg;base64,")
	assert len(base64.b64decode(data_url.split(",", 1)[1])) < 2_800_000


def test_text_extraction_replaces_invalid_utf8():
	result = extract_text("notes.txt", "text/plain", b"hello\xff")
	assert result.status == "ready"
	assert result.text.startswith("hello")
