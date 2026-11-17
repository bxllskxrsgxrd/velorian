import { useEffect, useRef, useState } from 'react';
import { useModelStore } from '../../stores/modelStore';
import type { AiModelOption } from '../../types/chat';
import './_modelSelector.scss';

function modelMark(model: AiModelOption) {
	if (model.id.startsWith('qwen')) return 'Q';
	if (model.provider === 'gemini') return 'G';
	return 'V';
}

type ModelSelectorProps = {
	disabled?: boolean;
};

export function ModelSelector({ disabled = false }: ModelSelectorProps) {
	const models = useModelStore((state) => state.models);
	const selectedModelId = useModelStore((state) => state.selectedModelId);
	const selectModel = useModelStore((state) => state.selectModel);
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const selectedModel = models.find((model) => model.id === selectedModelId && model.available)
		?? models.find((model) => model.available);

	useEffect(() => {
		if (!open) return;
		function handlePointerDown(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		}
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') setOpen(false);
		}
		document.addEventListener('pointerdown', handlePointerDown);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [open]);

	if (!selectedModel) return null;

	return (
		<div ref={rootRef} className="model-selector">
			<button
				className="model-selector__trigger"
				type="button"
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				aria-label={`Выбрать нейросеть. Сейчас ${selectedModel.name}`}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<span className="model-selector__mark">{modelMark(selectedModel)}</span>
				<span className="model-selector__name">{selectedModel.name}</span>
				<span className="model-selector__chevron" aria-hidden="true" />
			</button>

			{open && (
				<div className="model-selector__menu" role="menu" aria-label="Выберите нейросеть">
					<div className="model-selector__title">Выберите нейросеть</div>
					{models.map((model) => {
						const active = model.id === selectedModel.id;
						return (
							<button
								key={model.id}
								className={active ? 'model-selector__option model-selector__option--active' : 'model-selector__option'}
								type="button"
								role="menuitemradio"
								aria-checked={active}
								disabled={!model.available}
								onClick={() => {
									selectModel(model.id);
									setOpen(false);
								}}
							>
								<span className="model-selector__option-mark">{modelMark(model)}</span>
								<span className="model-selector__copy">
									<strong>{model.name}</strong>
									<small>{model.available ? model.description : 'Добавьте API-ключ на сервере'}</small>
								</span>
								{active ? (
									<span className="model-selector__check" aria-hidden="true">✓</span>
								) : (
									<span className="model-selector__badge">{model.available ? model.badge : 'Недоступна'}</span>
								)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
