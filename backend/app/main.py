import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
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

# описываю схему тела запроса: клиент должен отправить поле prompt
class PromptRequest(BaseModel):
	prompt: str

# список для хранения истории сообщений между пользователем и моделью
chat_history = []

# GET-эндпоинт / для проверки, что API работает
@app.get("/", tags=["ai-agent"])
def root():
	return {"status": "AI agent is running"}

# POST-эндпоинт /generate: принимает prompt, отправляет его в Groq и возвращает ответ модели
@app.post("/generate", tags=["ai-agent"])
def generate(request: PromptRequest):
	try:
		chat_history.append({
			"role": "user",
			"content": request.prompt
		})

		response = client.chat.completions.create(
			model="llama-3.3-70b-versatile",
			messages=chat_history
		)

		answer = response.choices[0].message.content

		chat_history.append({
			"role": "assistant",
			"content": answer
		})

		return {
			"response": answer,
			"history": chat_history
		}
    
	except Exception as e:
		print ("ERROR IN /generate", repr(e))
		raise HTTPException(status_code=500, detail=str(e))