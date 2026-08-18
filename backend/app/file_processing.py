import base64
import io
from dataclasses import dataclass
from pathlib import Path

from .config import settings
from .errors import AppError


TEXT_EXTENSIONS = {".txt", ".md", ".json", ".csv", ".log", ".html", ".css", ".js", ".ts", ".tsx", ".xml"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | IMAGE_EXTENSIONS | {".pdf", ".docx"}


@dataclass(frozen=True)
class ExtractedFile:
	text: str
	status: str


def is_image_file(file_name: str, content_type: str) -> bool:
	return Path(file_name).suffix.lower() in IMAGE_EXTENSIONS or content_type.startswith("image/")


def _load_image(content: bytes):
	from PIL import Image

	image = Image.open(io.BytesIO(content))
	if image.width * image.height > 40_000_000:
		raise AppError(413, "IMAGE_TOO_LARGE", "Разрешение изображения превышает безопасный лимит")
	image.load()
	return image


def image_to_data_url(content: bytes) -> str:
	from PIL import Image

	image = _load_image(content)
	if image.mode != "RGB":
		background = Image.new("RGB", image.size, "white")
		if "A" in image.getbands():
			background.paste(image, mask=image.getchannel("A"))
		else:
			background.paste(image.convert("RGB"))
		image = background
	image.thumbnail((2048, 2048))
	buffer = io.BytesIO()
	for quality in (82, 70, 55):
		buffer.seek(0)
		buffer.truncate(0)
		image.save(buffer, format="JPEG", quality=quality, optimize=True)
		if buffer.tell() <= 2_800_000:
			break
	if buffer.tell() > 2_800_000:
		image.thumbnail((1400, 1400))
		buffer.seek(0)
		buffer.truncate(0)
		image.save(buffer, format="JPEG", quality=55, optimize=True)
	encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
	return f"data:image/jpeg;base64,{encoded}"


def validate_file_name(file_name: str) -> str:
	name = Path(file_name or "Без имени").name[:255]
	extension = Path(name).suffix.lower()
	if extension not in SUPPORTED_EXTENSIONS:
		raise AppError(415, "UNSUPPORTED_FILE_TYPE", f"Формат {extension or 'без расширения'} не поддерживается")
	return name


def extract_text(file_name: str, content_type: str, content: bytes) -> ExtractedFile:
	extension = Path(file_name).suffix.lower()

	if extension in TEXT_EXTENSIONS or content_type.startswith("text/"):
		return ExtractedFile(content.decode("utf-8", errors="replace"), "ready")

	if extension == ".pdf":
		from pypdf import PdfReader

		reader = PdfReader(io.BytesIO(content))
		text = "\n\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
		return ExtractedFile(text, "ready" if text else "empty")

	if extension == ".docx":
		from docx import Document

		document = Document(io.BytesIO(content))
		text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
		return ExtractedFile(text, "ready" if text else "empty")

	if is_image_file(file_name, content_type):
		import pytesseract

		image = _load_image(content)
		try:
			text = pytesseract.image_to_string(image, lang=settings.ocr_languages).strip()
		except pytesseract.TesseractNotFoundError:
			return ExtractedFile("", "ocr_unavailable")
		except pytesseract.TesseractError:
			try:
				text = pytesseract.image_to_string(image, lang="eng").strip()
			except (pytesseract.TesseractError, pytesseract.TesseractNotFoundError):
				return ExtractedFile("", "ocr_unavailable")
		return ExtractedFile(text, "ready" if text else "empty")

	return ExtractedFile("", "unsupported")
