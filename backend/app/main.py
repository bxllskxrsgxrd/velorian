import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
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

# описываю в каком формате должны приходить данные
class ChatRequest(BaseModel):
	messages: list[ChatMessage]


# GET-эндпоинт / для проверки, что API работает
@app.get("/", tags=["ai-agent"])
def root():
	return {"status": "AI agent is running"}

# POST-эндпоинт /generate: принимает messages, отправляет его в Groq и возвращает ответ модели
@app.post("/generate", tags=["ai-agent"])
def generate(request: ChatRequest):
	try:
		messages = [
			{
				"role": Role.SYSTEM,
				"content": "Отвечай коротко и понятно",
			},
			*[message.model_dump() for message in request.messages],
		]

		response = client.chat.completions.create(
			model="llama-3.3-70b-versatile",
			messages=messages,
		)

		answer = response.choices[0].message.content

		return {
			"response": answer,
		}
    
	except Exception as e:
		print ("ERROR IN /generate", repr(e))
		raise HTTPException(status_code=500, detail=str(e))