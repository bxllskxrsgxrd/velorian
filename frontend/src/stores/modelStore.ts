import { create } from 'zustand';
import type { AiModelOption } from '../types/chat';

const STORAGE_KEY = 'velorian:selected-ai-model';

const FALLBACK_MODELS: AiModelOption[] = [
	{
		id: 'gpt-oss-120b',
		name: 'GPT-OSS 120B',
		description: 'Лучший баланс качества и скорости',
		provider: 'groq',
		available: true,
	},
	{
		id: 'qwen-3.8',
		name: 'Qwen 3.8',
		description: 'Рассуждения, код и работа с изображениями',
		provider: 'groq',
		badge: 'Vision',
		available: true,
	},
	{
		id: 'gemini-3.8-flash',
		name: 'Gemini 3.8 Flash',
		description: 'Быстрые ответы и большой контекст',
		provider: 'gemini',
		badge: 'Google',
		available: false,
	},
];

function savedModelId() {
	try {
		return window.localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function saveModelId(modelId: string) {
	try {
		window.localStorage.setItem(STORAGE_KEY, modelId);
	} catch {
		// Local storage can be unavailable in private or restricted browser contexts.
	}
}

type ModelStore = {
	models: AiModelOption[];
	selectedModelId: string;
	configure: (models: AiModelOption[], defaultModelId: string) => void;
	selectModel: (modelId: string) => void;
};

export const useModelStore = create<ModelStore>((set, get) => ({
	models: FALLBACK_MODELS,
	selectedModelId: savedModelId() ?? 'gpt-oss-120b',
	configure: (models, defaultModelId) => {
		if (models.length === 0) return;
		const currentId = savedModelId() ?? get().selectedModelId;
		const selected = models.find((model) => model.id === currentId && model.available)
			?? models.find((model) => model.id === defaultModelId && model.available)
			?? models.find((model) => model.available);
		if (!selected) return set({ models });
		saveModelId(selected.id);
		set({ models, selectedModelId: selected.id });
	},
	selectModel: (modelId) => {
		if (!get().models.some((model) => model.id === modelId && model.available)) return;
		saveModelId(modelId);
		set({ selectedModelId: modelId });
	},
}));
