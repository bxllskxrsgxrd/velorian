from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float
    is_offer: bool | None = None
    q: str


@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.get("/items/{item_id}", tags=["items"], operation_id="getItem")
def get_item(item_id: int, q: str | None = None): 
    return {"item_id": item_id, "q": q}


@app.put("/items/{item_id}")
def update_item(item_id: int, item: Item):
    return {"item_name": item.name, "item_id": item_id, "item_price": item.price, "q": item.q}