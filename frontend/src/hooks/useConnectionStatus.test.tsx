import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStatus } from './useConnectionStatus';

const connectionApi = vi.hoisted(() => ({
	listener: null as ((connected: boolean) => void) | null,
	apiFetch: vi.fn(),
	subscribeConnection: vi.fn((listener: (connected: boolean) => void) => {
		connectionApi.listener = listener;
		listener(true);
		return () => { connectionApi.listener = null; };
	}),
}));

vi.mock('../api/httpClient', () => ({ apiFetch: connectionApi.apiFetch, subscribeConnection: connectionApi.subscribeConnection }));

function StatusProbe() {
	const { status, attempt } = useConnectionStatus();
	return <span>{status}:{attempt}</span>;
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('useConnectionStatus', () => {
	it('uses one reconnect loop and reports recovery', async () => {
		vi.useFakeTimers();
		connectionApi.apiFetch.mockResolvedValue(new Response('{}', { status: 200 }));
		const view = render(<StatusProbe />);
		act(() => { connectionApi.listener?.(false); connectionApi.listener?.(false); });
		expect(screen.getByText('disconnected:0')).toBeInTheDocument();
		await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
		expect(connectionApi.apiFetch).toHaveBeenCalledOnce();
		expect(screen.getByText('restored:0')).toBeInTheDocument();
		view.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
