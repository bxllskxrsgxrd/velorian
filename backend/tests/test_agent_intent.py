import asyncio
import json
from types import SimpleNamespace

from app.agent_intent import resolve_agent_intent


class CatalogSession:
	def __init__(self):
		self.definitions = [
			SimpleNamespace(id="filter-approach", name="Подход", slug="podhod", options=[
				SimpleNamespace(id="option-interview", value="Интервью", normalized_value="интервью", aliases=[]),
				SimpleNamespace(id="option-show-approach", value="Шоу", normalized_value="шоу", aliases=[]),
			]),
			SimpleNamespace(id="filter-geo", name="ГЕО", slug="geo", options=[
				SimpleNamespace(id="option-brazil", value="Brazil", normalized_value="brazil", aliases=[SimpleNamespace(value="Бразилия")]),
				SimpleNamespace(id="option-mexico", value="Mexico", normalized_value="mexico", aliases=[SimpleNamespace(value="Мексика")]),
			]),
			SimpleNamespace(id="filter-offer", name="Оффер", slug="offer", options=[
				SimpleNamespace(id="option-show-offer", value="Show", normalized_value="show", aliases=[]),
			]),
		]

	def scalars(self, _statement):
		return self.definitions


class SemanticCompletions:
	async def create(self, **kwargs):
		prompt = json.loads(kwargs["messages"][-1]["content"])["userPrompt"]
		if "бразил" in prompt.casefold():
			payload = {
				"action": "knowledge_search", "output_mode": "chat", "knowledge_intent": "list",
				"knowledge_query": "материалы", "filter_option_ids": ["option-brazil"],
			}
		elif "интервью" in prompt.casefold():
			payload = {
				"action": "knowledge_search", "output_mode": "chat", "knowledge_intent": "list",
				"knowledge_query": "материалы", "filter_option_ids": ["option-interview"],
			}
		else:
			payload = {
				"action": "generate_code", "language": "javascript", "output_mode": "file",
				"file_type": "js", "knowledge_intent": "none",
			}
		return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])


class SemanticClient:
	def __init__(self):
		self.chat = SimpleNamespace(completions=SemanticCompletions())


def resolve(prompt: str):
	return asyncio.run(resolve_agent_intent(
		CatalogSession(), "user-1", prompt, client=SemanticClient(), explicit_knowledge=False,
	))


def test_semantically_equivalent_file_prompts_have_the_same_execution_intent():
	prompts = (
		"напиши скрипт на js и закинь его в файл",
		"напиши скрипт на js, создай файл с этим скриптом",
		"сохрани этот JS-код в файл",
	)
	intents = [resolve(prompt) for prompt in prompts]
	assert {(intent.action, intent.language, intent.output_mode, intent.file_type) for intent in intents} == {
		("generate_code", "javascript", "file", "js"),
	}


def test_semantically_equivalent_knowledge_prompts_resolve_real_option_ids():
	prompts = (
		"найди материалы по интервью",
		"используй данные с подходом интервью",
		"что у меня есть для интервью?",
	)
	intents = [resolve(prompt) for prompt in prompts]
	assert {tuple(intent.filter_option_ids) for intent in intents} == {("option-interview",)}
	assert {intent.action for intent in intents} == {"knowledge_search"}


def test_contextual_geo_wording_resolves_the_same_metadata_constraint():
	prompts = (
		"что есть для Бразилии?",
		"покажи бразильские материалы",
		"используй данные по гео Бразилия",
	)
	assert {tuple(resolve(prompt).filter_option_ids) for prompt in prompts} == {("option-brazil",)}


def test_invented_option_ids_are_rejected_without_broadening_knowledge_search():
	class InventedOptionCompletions:
		async def create(self, **_kwargs):
			payload = {
				"action": "knowledge_search", "output_mode": "chat", "knowledge_intent": "search",
				"knowledge_query": "материалы", "filter_option_ids": ["invented-france-id"],
			}
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])

	client = SimpleNamespace(chat=SimpleNamespace(completions=InventedOptionCompletions()))
	intent = asyncio.run(resolve_agent_intent(
		CatalogSession(), "user-1", "используй материалы для Франции", client=client,
	))
	assert intent.filter_option_ids == []
	assert intent.unresolved_filters == [{"filterName": "Метаданные", "value": "нераспознанное значение"}]


def test_resolver_does_not_turn_a_filter_definition_explanation_into_a_constraint():
	class ExplanationCompletions:
		async def create(self, **_kwargs):
			payload = {
				"action": "general", "output_mode": "chat", "knowledge_intent": "none",
				"knowledge_query": "", "filter_option_ids": [],
			}
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])

	client = SimpleNamespace(chat=SimpleNamespace(completions=ExplanationCompletions()))
	intent = asyncio.run(resolve_agent_intent(
		CatalogSession(), "user-1", "объясни, что означает термин ГЕО", client=client,
	))
	assert intent.action == "general"
	assert intent.filter_option_ids == []


def test_structured_groups_keep_or_options_together_and_validate_ids():
	class GroupCompletions:
		async def create(self, **_kwargs):
			payload = {
				"action": "knowledge_search", "output_mode": "chat", "knowledge_intent": "search",
				"knowledge_query": "", "filters": [
					{"filterId": "filter-geo", "optionIds": ["option-brazil", "option-mexico"], "status": "resolved", "confidence": .98, "explicit": True},
					{"filterId": "filter-approach", "optionIds": ["option-interview"], "status": "resolved", "confidence": .95, "explicit": True},
				],
			}
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])

	client = SimpleNamespace(chat=SimpleNamespace(completions=GroupCompletions()))
	intent = asyncio.run(resolve_agent_intent(
		CatalogSession(), "user-1", "интервью для Brazil и Mexico", client=client,
	))
	groups = {group.filter_id: set(group.option_ids) for group in intent.filters}
	assert groups == {
		"filter-approach": {"option-interview"},
		"filter-geo": {"option-brazil", "option-mexico"},
	}


def test_ambiguous_resolution_is_not_applied_as_a_constraint():
	class AmbiguousCompletions:
		async def create(self, **_kwargs):
			payload = {
				"action": "knowledge_search", "output_mode": "chat", "knowledge_intent": "search",
				"knowledge_query": "материалы", "filters": [
					{"filterId": "filter-approach", "optionIds": ["option-show-approach"], "status": "ambiguous", "confidence": .45, "value": "show"},
					{"filterId": "filter-offer", "optionIds": ["option-show-offer"], "status": "ambiguous", "confidence": .45, "value": "show"},
				],
			}
			return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])

	client = SimpleNamespace(chat=SimpleNamespace(completions=AmbiguousCompletions()))
	intent = asyncio.run(resolve_agent_intent(CatalogSession(), "user-1", "покажи show материалы", client=client))
	assert intent.filter_option_ids == []
	assert intent.filters == []
	assert {value["filterName"] for value in intent.ambiguous_filters} == {"Подход", "Оффер"}
