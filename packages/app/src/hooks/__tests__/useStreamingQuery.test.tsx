import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { mergeStreams, useStreamingQuery } from '@/hooks/useStreamingQuery';

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

  it('resolves to the complete set even when flushes are throttled away', async () => {
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

  it('publishes a chunk that lands within the flush interval when it ends', async () => {
    let releaseStream: () => void = () => {};
    const streamGate = new Promise<void>(resolve => {
      releaseStream = resolve;
    });
    const streamFactory = async function* () {
      yield ['a'];
      yield ['b'];
      await streamGate;
    };

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['trailing'],
          streamFactory,
          flushIntervalMs: 50,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data).toEqual(['a', 'b']));
    expect(result.current.isStreaming).toBe(true);

    releaseStream();
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
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

  it('does not write a superseded stream into the cache', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let releaseLateChunk: () => void = () => {};
    const lateChunkGate = new Promise<void>(resolve => {
      releaseLateChunk = resolve;
    });
    let isSupersededStreamDone = false;
    const streams: Record<string, () => AsyncGenerator<string[]>> = {
      a: async function* () {
        try {
          yield ['a1'];
          await lateChunkGate;
          yield ['a2'];
        } finally {
          isSupersededStreamDone = true;
        }
      },
      b: async function* () {
        yield ['b1'];
      },
    };

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useStreamingQuery<string>({
          queryKey: [id],
          streamFactory: streams[id],
          flushIntervalMs: 0,
        }),
      { wrapper, initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toEqual(['a1']));

    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data).toEqual(['b1']));
    releaseLateChunk();
    await waitFor(() => expect(isSupersededStreamDone).toBe(true));

    // Reverted on cancel; a late write would be served as complete forever.
    expect(queryClient.getQueryData(['a'])).toBeUndefined();
  });

  it('keeps the complete result in place while a refetch streams', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let releaseRefetch: () => void = () => {};
    const refetchGate = new Promise<void>(resolve => {
      releaseRefetch = resolve;
    });
    let isRefetchWaiting = false;
    let runs = 0;
    const streamFactory = async function* () {
      runs++;
      if (runs === 1) {
        yield ['a', 'b'];
        return;
      }
      yield ['c'];
      isRefetchWaiting = true;
      await refetchGate;
      yield ['d'];
    };

    const { result } = renderHook(
      () =>
        useStreamingQuery<string>({
          queryKey: ['refetch'],
          streamFactory,
          flushIntervalMs: 0,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    const refetch = queryClient.refetchQueries({ queryKey: ['refetch'] });
    await waitFor(() => expect(isRefetchWaiting).toBe(true));
    expect(result.current.data).toEqual(['a', 'b']);

    releaseRefetch();
    await refetch;
    await waitFor(() => expect(result.current.data).toEqual(['c', 'd']));
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

describe('mergeStreams', () => {
  async function drain<T>(stream: AsyncIterable<T>) {
    const chunks: T[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
  }

  it('yields chunks in arrival order across streams', async () => {
    let releaseSlow: () => void = () => {};
    const slowGate = new Promise<void>(resolve => {
      releaseSlow = resolve;
    });
    const slow = async function* () {
      await slowGate;
      yield 'slow';
    };
    const fast = async function* () {
      yield 'fast-1';
      yield 'fast-2';
      releaseSlow();
    };

    await expect(drain(mergeStreams([slow(), fast()]))).resolves.toEqual([
      'fast-1',
      'fast-2',
      'slow',
    ]);
  });

  const failingStream = (
    error: Error,
    after?: Promise<void>,
  ): AsyncIterable<string> => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await after;
        throw error;
      },
    }),
  });

  it('keeps yielding from the other streams when one fails', async () => {
    const healthy = async function* () {
      yield 'a';
    };

    const merged = mergeStreams([failingStream(new Error('boom')), healthy()]);
    await expect(drain(merged)).resolves.toEqual(['a']);
  });

  it("throws the first stream's error when every stream fails", async () => {
    const afterATick = new Promise<void>(resolve => setTimeout(resolve, 0));

    const merged = mergeStreams([
      failingStream(new Error('first'), afterATick),
      failingStream(new Error('second')),
    ]);
    await expect(drain(merged)).rejects.toThrow('first');
  });

  it('yields nothing for no streams', async () => {
    await expect(drain(mergeStreams([]))).resolves.toEqual([]);
  });
});
