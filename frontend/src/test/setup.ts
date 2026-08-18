import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
	observe() {}
	disconnect() {}
	unobserve() {}
}

Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock });
