import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useStreamingQuery } from '@/hooks/useStreamingQuery';

// One client per test, built outside the wrapper so a re-render cannot swap it
// out from under an in-flight stream.
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useStreamingQuery', () => {
  it('publishes partial results before the stream completes', async () => {
    let releaseSecondChunk: () => void = () => {};
    const secondChunkGate = new Promise<void>(resolve => {
      releaseSecondChunk = resolve;
    });

    const streamFactory = async function* () {
      yield ['a', 'b'];
      await secondChunkGate;
      yield ['c'];
    };

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['partial'],
          streamFactory,
          flushIntervalMs: 0, // publish every chunk, don't race the throttle
        }),
      { wrapper: createWrapper() },
    );

    // Visible while the query is still in flight — the point of the hook.
    await waitFor(() => expect(result.current.data).toEqual(['a', 'b']));
    expect(result.current.isStreaming).toBe(true);

    releaseSecondChunk();

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.data).toEqual(['a', 'b', 'c']);
  });

  it('resolves to the complete set even when every flush is throttled away', async () => {
    const streamFactory = async function* () {
      yield ['a'];
      yield ['b'];
    };

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['throttled'],
          streamFactory,
          flushIntervalMs: 60_000,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.data).toEqual(['a', 'b']);
  });

  it('discards partial results when the stream fails mid-way', async () => {
    const streamFactory = async function* () {
      yield ['a'];
      throw new Error('connection reset');
    };

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['failure'],
          streamFactory,
          flushIntervalMs: 0,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe('connection reset');
  });

  it('does not run the stream when disabled', async () => {
    const streamFactory = jest.fn(async function* () {
      yield ['a'];
    });

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['disabled'],
          streamFactory,
          enabled: false,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(streamFactory).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('reports an empty stream as a completed empty result', async () => {
    const streamFactory = async function* (): AsyncGenerator<string[]> {
      // no chunks
    };

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['empty'],
          streamFactory,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});
