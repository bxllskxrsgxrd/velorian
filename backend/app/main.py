import os
from pathlib import Path
from typing import Literal
import json

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from enum import Enum
from pydantic import BaseModel
from dotenv import load_dotenv
from groq import Groq

# загружаю переменные из .env
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

load_dotenv(dotenv_path=ENV_PATH)

# получаю API-ключ Groq из переменных окружения
api_key = os.environ.get("GROQ_API_KEY")

# обработка ошибки, если ключ не найден в переменной окружения
if not api_key:
	raise ValueError(f"GROQ_API_KEY not found in {ENV_PATH}")

# инициализирую клиента, с помощью которого буду общаться с Groq
client = Groq(api_key=api_key)

# создаю экземпляр приложения FastAPI
app = FastAPI()

origins = [
	"http://localhost",
	"http://localhost:8080",
	"http://localhost:5173",
]

app.add_middleware(
	CORSMiddleware,
	allow_origins=origins,
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# создаю переменные для переиспользования ролей с типизацией для защиты от изменений
# Enum в Python — это специальный класс из встроенного модуля enum для создания перечислений, представляющих собой набор именованных констант
class Role(str, Enum):
	USER = "user"
	ASSISTANT = "assistant"
	SYSTEM = "system"

# описываю схему тела сообщения, которое приходит с фронта. валидирую с помощью Literal
class ChatMessage(BaseModel):
	role: Literal[Role.USER, Role.ASSISTANT, Role.SYSTEM]
	content: str

# GET-эндпоинт / для проверки, что API работает
@app.get("/", tags=["ai-agent"])
def root():
	return {"status": "AI agent is running"}

# POST-эндпоинт /generate: принимает groq_messages, отправляет его в Groq и возвращает ответ модели
@app.post("/generate", tags=["ai-agent"])
async def generate(
	messages: str = Form(...),
	files: list[UploadFile] = File(default=[])
):
	try:
		# с помощью json.loads(messages) превращаю json-строку в python-список, а ChatMessage(**item) - превращаю каждый словарь в объект
		parsed_messages = [ChatMessage(**item) for item in json.loads(messages)]

		# проверка на тестовую ошибку 500, если переменная окружения APP_ENV не равна production
		if os.getenv("APP_ENV") != "production":
			for message in parsed_messages:
				if message.role == Role.USER and message.content.strip() == "__TEST_500__":
					raise HTTPException(
						status_code=500,
						detail="Тестовая ошибка 500",
					)
				
		# пустой список для дальнейшего заполнения текстом из файлов
		file_texts = []

		# Прохожусь по каждому файлу, который пришёл с фронта
		for file in files:
			# возвращаю байты
			content = await file.read()

			# пытаемся прочитать файл как текст в кодировке utf-8
			try:
				text = content.decode("utf-8")
			except UnicodeDecodeError:
				# errors="ignore" значит: Если встретились странные символы, просто пропусти их
				text = content.decode("utf-8", errors="ignore")

			# Добавляем текст файла в список file_texts
			file_texts.append(f'Файл: {file.filename}\nСодержимое: {text}')

		# соединяю все файлы в одну большую строку
		extra_file_context = "\n\n".join(file_texts)

		groq_messages = [
			{
				"role": Role.SYSTEM,
				"content": "Отвечай коротко и понятно",
			},
			# message.model_dump() каждый объект превращает в словарь, тк Groq ждёт обычные словари, а * распаковывает список внутрь другого списка
			*[message.model_dump() for message in parsed_messages],
		]

		# проверка, есть ли текст из файлов
		if extra_file_context:
			groq_messages.append(
				{
					'role': Role.USER,
					"content": f"Проанализируй прикрпеленные файлы:\n\n{extra_file_context}",
				}
			)

		# отправка запроса в Groq
		response = client.chat.completions.create(
			model="llama-3.3-70b-versatile",
			messages=groq_messages,
		)

		# Groq возвращает объект с ответом
		answer = response.choices[0].message.content

		# Отправляем ответ обратно на фронт
		return {
			"response": answer,
		}
			
	# обработка ошибки
	except Exception as e:
		print ("ERROR IN /generate", repr(e))
		raise HTTPException(status_code=500, detail=str(e))