import { useLayoutEffect, useMemo, useRef } from 'react';
import { createStore, useStore } from 'zustand';

type UseTextareaMultilineProps = {
	value: string;
	maxHeight?: number;
};

function updateScrollMask(textarea: HTMLTextAreaElement) {
	const { scrollTop, scrollHeight, clientHeight } = textarea;
	const threshold = 1;
	const hasOverflow = scrollHeight > clientHeight + threshold;
	textarea.style.setProperty('--top-fade', hasOverflow && scrollTop > threshold ? 'transparent' : 'var(--color-mask-opaque)');
	textarea.style.setProperty(
		'--bottom-fade',
		hasOverflow && scrollTop + clientHeight < scrollHeight - threshold ? 'transparent' : 'var(--color-mask-opaque)',
	);
}

function createTextareaUiStore() {
	return createStore<{ isMultiline: boolean; setMultiline: (value: boolean) => void }>((set) => ({
		isMultiline: false,
		setMultiline: (isMultiline) => set({ isMultiline }),
	}));
}

export function useTextareaMultiline({ value, maxHeight = 320 }: UseTextareaMultilineProps) {
	const store = useMemo(() => createTextareaUiStore(), []);
	const isMultiline = useStore(store, (state) => state.isMultiline);
	const setIsMultiline = useStore(store, (state) => state.setMultiline);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		const styles = getComputedStyle(textarea);
		const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
		const padding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
		const singleLineHeight = lineHeight + padding;

		textarea.style.height = 'auto';
		const contentHeight = textarea.scrollHeight;
		const nextHeight = Math.min(Math.max(contentHeight, singleLineHeight), maxHeight);
		textarea.style.height = `${nextHeight}px`;
		textarea.style.maxHeight = `${maxHeight}px`;
		textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';

		const nextMultiline = value.includes('\n') || contentHeight > singleLineHeight + 1;
		if (isMultiline !== nextMultiline) setIsMultiline(nextMultiline);
		updateScrollMask(textarea);
	}, [isMultiline, maxHeight, setIsMultiline, value]);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		const handleUpdate = () => updateScrollMask(textarea);
		const observer = new ResizeObserver(handleUpdate);
		observer.observe(textarea);
		textarea.addEventListener('scroll', handleUpdate);
		return () => {
			observer.disconnect();
			textarea.removeEventListener('scroll', handleUpdate);
		};
	}, []);

	return { textareaRef, isMultiline };
}
