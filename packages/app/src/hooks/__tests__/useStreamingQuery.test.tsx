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

  describe('itemKey', () => {
    type Item = { id: string; version: number };
    const itemKey = (item: Item) => item.id;

    it("shows a new key's stream over the last complete result", async () => {
      let releaseLastChunk: () => void = () => {};
      const lastChunkGate = new Promise<void>(resolve => {
        releaseLastChunk = resolve;
      });
      const streams: Record<string, () => AsyncGenerator<Item[]>> = {
        first: async function* () {
          yield [
            { id: 'x', version: 1 },
            { id: 'y', version: 1 },
          ];
        },
        second: async function* () {
          yield [{ id: 'y', version: 2 }];
          await lastChunkGate;
          yield [{ id: 'z', version: 2 }];
        },
      };

      const { result, rerender } = renderHook(
        ({ id }: { id: string }) =>
          useStreamingQuery<Item>({
            queryKey: [id],
            streamFactory: streams[id],
            flushIntervalMs: 0,
            itemKey,
          }),
        { wrapper: createWrapper(), initialProps: { id: 'first' } },
      );
      await waitFor(() => expect(result.current.isStreaming).toBe(false));

      rerender({ id: 'second' });

      // `x` keeps its old version until the stream completes; `y` is swapped
      // in place rather than moved.
      await waitFor(() =>
        expect(result.current.data).toEqual([
          { id: 'x', version: 1 },
          { id: 'y', version: 2 },
        ]),
      );
      expect(result.current.isStreaming).toBe(true);

      releaseLastChunk();

      await waitFor(() => expect(result.current.isStreaming).toBe(false));
      expect(result.current.data).toEqual([
        { id: 'y', version: 2 },
        { id: 'z', version: 2 },
      ]);
    });

    it('streams from empty when there is no complete result yet', async () => {
      let releaseLastChunk: () => void = () => {};
      const lastChunkGate = new Promise<void>(resolve => {
        releaseLastChunk = resolve;
      });
      const streamFactory = async function* () {
        yield [{ id: 'x', version: 1 }];
        await lastChunkGate;
      };

      const { result } = renderHook(
        () =>
          useStreamingQuery<Item>({
            queryKey: ['no-previous'],
            streamFactory,
            flushIntervalMs: 0,
            itemKey,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() =>
        expect(result.current.data).toEqual([{ id: 'x', version: 1 }]),
      );
      releaseLastChunk();
      await waitFor(() => expect(result.current.isStreaming).toBe(false));
    });
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
