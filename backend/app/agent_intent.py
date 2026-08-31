import json
import logging
import re
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .knowledge_filters import normalize_filter_value
from .models import KnowledgeFilterDefinition


logger = logging.getLogger("velorian")


class IntentFilterResolution(BaseModel):
	model_config = ConfigDict(populate_by_name=True)

	filter_id: str = Field(alias="filterId", min_length=1, max_length=36)
	option_ids: list[str] = Field(default_factory=list, alias="optionIds", max_length=50)
	status: Literal["resolved", "ambiguous", "unresolved"] = "resolved"
	confidence: float = Field(default=1.0, ge=0, le=1)
	explicit: bool = False
	value: str = Field(default="", max_length=120)


class AgentIntent(BaseModel):
	action: Literal["general", "generate_code", "generate_content", "knowledge_search"] = "general"
	language: str | None = None
	output_mode: Literal["chat", "file", "chat_and_file"] = "chat"
	file_type: str | None = None
	requested_filename: str | None = None
	knowledge_intent: Literal["none", "search", "list"] = "none"
	knowledge_query: str = ""
	filter_option_ids: list[str] = Field(default_factory=list, max_length=50)
	filters: list[IntentFilterResolution] = Field(default_factory=list, max_length=50)
	unresolved_filters: list[dict[str, str]] = Field(default_factory=list, max_length=20)
	ambiguous_filters: list[dict[str, str]] = Field(default_factory=list, max_length=20)

	@field_validator("language")
	@classmethod
	def normalize_language(cls, value: str | None) -> str | None:
		if value is None:
			return None
		normalized = value.casefold().replace(".", "").replace("-", " ").strip()
		return {
			"js": "javascript", "java script": "javascript", "javascript": "javascript", "node js": "javascript",
			"ts": "typescript", "type script": "typescript", "typescript": "typescript",
			"py": "python", "python": "python",
		}.get(normalized, normalized.replace(" ", "_"))

	@field_validator("file_type")
	@classmethod
	def normalize_file_type(cls, value: str | None) -> str | None:
		return value.casefold().strip().lstrip(".")[:16] if value else None


class IntentCompletionClient(Protocol):
	chat: object


def available_filter_catalog(db: Session, user_id: str) -> list[dict]:
	definitions = list(db.scalars(select(KnowledgeFilterDefinition).where(
		KnowledgeFilterDefinition.user_id == user_id,
	).order_by(KnowledgeFilterDefinition.name.asc())))
	return [
		{
			"id": definition.id,
			"name": definition.name,
			"slug": definition.slug,
			"options": [
				{
					"id": option.id, "value": option.value,
					"normalizedValue": getattr(option, "normalized_value", normalize_filter_value(option.value)),
					"aliases": [alias.value for alias in getattr(option, "aliases", [])],
				}
				for option in definition.options
			],
		}
		for definition in definitions
	]


def _safe_filename_from_entity(prompt: str) -> str | None:
	# This extracts a filename entity only; it does not infer intent from a phrase.
	match = re.search(r"(?<![\w./-])([\w()+#-]+\.[a-zA-Z0-9]{1,10})(?![\w./-])", prompt)
	return match.group(1) if match else None


def conservative_fallback_intent(prompt: str, *, explicit_knowledge: bool) -> AgentIntent:
	filename = _safe_filename_from_entity(prompt)
	return AgentIntent(
		action="knowledge_search" if explicit_knowledge else "general",
		output_mode="file" if filename else "chat",
		requested_filename=filename,
		file_type=filename.rsplit(".", 1)[-1].lower() if filename else None,
		knowledge_intent="search" if explicit_knowledge else "none",
		knowledge_query=prompt if explicit_knowledge else "",
	)


def _completion_content(response: object) -> str:
	choices = getattr(response, "choices", None)
	if not choices:
		raise ValueError("Intent resolver returned no choices")
	content = getattr(getattr(choices[0], "message", None), "content", None)
	if not isinstance(content, str):
		raise ValueError("Intent resolver returned no JSON content")
	return content


async def resolve_agent_intent(
	db: Session,
	user_id: str,
	prompt: str,
	*,
	client: IntentCompletionClient | None,
	explicit_knowledge: bool = False,
) -> AgentIntent:
	fallback = conservative_fallback_intent(prompt, explicit_knowledge=explicit_knowledge)
	if client is None:
		return fallback
	catalog = available_filter_catalog(db, user_id)
	resolver_prompt = {
		"userPrompt": prompt,
		"explicitKnowledgeMode": explicit_knowledge,
		"availableFilters": catalog,
	}
	system = (
		"Resolve the user's semantic task into JSON. Do not answer the task. "
		"Equivalent wording must produce equivalent fields. Use output_mode=file only when the user asks for a real file/artifact; "
		"plain code requests use chat. Use action=knowledge_search for browsing or using the knowledge base. "
		"For filters, return only option IDs present in availableFilters. Never invent IDs. "
		"Return filter resolutions as filters=[{filterId,optionIds,status,confidence,explicit,value}]. "
		"Use status=ambiguous instead of guessing when the same or similar value can mean different filters. "
		"Apply this priority: explicit filter name plus option, exact option, normalized exact option, alias, contextual semantic match. "
		"Multiple options of one filter belong in one optionIds array (OR); different filter blocks are AND. "
		"knowledge_query must contain only the residual topic after removing resolved metadata and generic words such as materials/data; use an empty string for metadata-only requests. "
		"If a requested value clearly belongs to a known filter but has no option, add {filterName,value} to unresolved_filters. "
		"Return exactly these keys: action, language, output_mode, file_type, requested_filename, knowledge_intent, "
		"knowledge_query, filters, unresolved_filters, ambiguous_filters. knowledge_intent is none/search/list."
	)
	try:
		response = await client.chat.completions.create(
			model=settings.groq_model,
			messages=[
				{"role": "system", "content": system},
				{"role": "user", "content": json.dumps(resolver_prompt, ensure_ascii=False)},
			],
			response_format={"type": "json_object"},
			stream=False,
			max_completion_tokens=700,
			user=user_id,
		)
		intent = AgentIntent.model_validate_json(_completion_content(response))
	except (Exception, ValidationError) as error:
		logger.warning("Agent intent resolution failed; using conservative fallback: %s", type(error).__name__)
		return fallback
	definitions = {definition["id"]: definition for definition in catalog}
	option_to_filter = {
		option["id"]: definition["id"]
		for definition in catalog
		for option in definition["options"]
	}
	legacy_groups: list[IntentFilterResolution] = []
	for option_id in intent.filter_option_ids:
		filter_id = option_to_filter.get(option_id)
		if filter_id:
			legacy_groups.append(IntentFilterResolution(
				filterId=filter_id, optionIds=[option_id], status="resolved", confidence=1, explicit=True,
			))
	invalid_option_ids = [option_id for option_id in intent.filter_option_ids if option_id not in option_to_filter]
	merged: dict[str, IntentFilterResolution] = {}
	for resolution in [*intent.filters, *legacy_groups]:
		definition = definitions.get(resolution.filter_id)
		valid_ids = set(option["id"] for option in definition["options"]) if definition else set()
		valid_selected = [option_id for option_id in resolution.option_ids if option_id in valid_ids]
		invalid_option_ids.extend(option_id for option_id in resolution.option_ids if option_id not in valid_ids)
		label = definition["name"] if definition else "Фильтр"
		resolved_value = ", ".join(
			option["value"] for option in definition["options"] if option["id"] in valid_selected
		) if definition else ""
		value = resolution.value or resolved_value
		if resolution.status == "ambiguous" or (resolution.status == "resolved" and not resolution.explicit and resolution.confidence < 0.75):
			intent.ambiguous_filters.append({"filterName": label, "value": value or "неоднозначное значение"})
			continue
		if resolution.status == "unresolved" or definition is None:
			intent.unresolved_filters.append({"filterName": label, "value": value or "нераспознанное значение"})
			continue
		if not valid_selected:
			continue
		current = merged.get(resolution.filter_id)
		if current is None:
			merged[resolution.filter_id] = IntentFilterResolution(
				filterId=resolution.filter_id, optionIds=valid_selected, status="resolved",
				confidence=resolution.confidence, explicit=resolution.explicit,
			)
		else:
			current.option_ids = list(dict.fromkeys([*current.option_ids, *valid_selected]))
			current.explicit = current.explicit or resolution.explicit
			current.confidence = max(current.confidence, resolution.confidence)
	intent.filters = [merged[filter_id] for filter_id in sorted(merged)]
	intent.filter_option_ids = [option_id for group in intent.filters for option_id in group.option_ids]
	if invalid_option_ids and not intent.unresolved_filters:
		intent.unresolved_filters = [{"filterName": "Метаданные", "value": "нераспознанное значение"}]
	if explicit_knowledge:
		intent.action = "knowledge_search"
		if intent.knowledge_intent == "none":
			intent.knowledge_intent = "search"
	if intent.action != "knowledge_search":
		intent.knowledge_intent = "none"
		intent.filter_option_ids = []
		intent.filters = []
		intent.unresolved_filters = []
		intent.ambiguous_filters = []
	if settings.app_env == "development":
		logger.info("[AGENT_INTENT] %s", json.dumps({
			"action": intent.action, "language": intent.language, "outputMode": intent.output_mode,
			"fileType": intent.file_type, "knowledgeIntent": intent.knowledge_intent,
			"resolvedFilterOptionIds": intent.filter_option_ids,
			"unresolvedFilterCount": len(intent.unresolved_filters),
			"ambiguousFilterCount": len(intent.ambiguous_filters),
			"availableFilterCount": len(catalog),
			"availableOptionCount": sum(len(definition["options"]) for definition in catalog),
		}, ensure_ascii=False))
	return intent
