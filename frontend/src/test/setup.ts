import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

class ResizeObserverMock {
	observe() {}
	disconnect() {}
	unobserve() {}
}

Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock });
