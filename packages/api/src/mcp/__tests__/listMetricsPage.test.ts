import {
  assembleMetricsPage,
  KIND_TIMED_OUT_ERROR,
  type KindScan,
  scanKindsForPage,
} from '@/mcp/tools/sources/listMetricsPage';
import type { DiscoverableMetricKind } from '@/mcp/tools/sources/metricKinds';

const ok = (...names: string[]): KindScan => ({ status: 'ok', names });

describe('assembleMetricsPage', () => {
  const kinds: DiscoverableMetricKind[] = ['gauge', 'sum', 'histogram'];

  it('concatenates kinds in order when everything fits', () => {
    const page = assembleMetricsPage(
      kinds,
      [ok('a'), ok('b', 'c'), ok()],
      10,
      false,
    );
    expect(page).toEqual({
      entries: [
        { name: 'a', kind: 'gauge' },
        { name: 'b', kind: 'sum' },
        { name: 'c', kind: 'sum' },
      ],
      partialFailure: [],
    });
  });

  it('truncates the overflowing kind and points the cursor at its last kept name', () => {
    const page = assembleMetricsPage(
      kinds,
      [ok('a'), ok('b', 'c', 'd'), { status: 'pending' }],
      2,
      false,
    );
    expect(page?.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(page?.next).toEqual({ kind: 'sum', lastName: 'b' });
  });

  it('emits a cursor when an earlier kind exactly fills the page and a later kind has names', () => {
    const page = assembleMetricsPage(
      kinds,
      [ok('a', 'b'), ok('c'), ok()],
      2,
      false,
    );
    expect(page?.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(page?.next).toEqual({ kind: 'gauge', lastName: 'b' });
  });

  it('waits while a pending kind can still change the page', () => {
    expect(
      assembleMetricsPage(
        kinds,
        [ok('a'), { status: 'pending' }, ok('b')],
        10,
        false,
      ),
    ).toBeNull();
  });

  it('reports pending kinds as timed out when finalizing and keeps finished kinds', () => {
    const page = assembleMetricsPage(
      kinds,
      [ok('a'), { status: 'pending' }, ok('b')],
      10,
      true,
    );
    expect(page?.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(page?.partialFailure).toEqual([
      { kind: 'sum', error: KIND_TIMED_OUT_ERROR },
    ]);
  });

  it('skips failed kinds and records them', () => {
    const page = assembleMetricsPage(
      kinds,
      [{ status: 'error', error: 'boom' }, ok('a'), ok()],
      10,
      false,
    );
    expect(page?.entries).toEqual([{ name: 'a', kind: 'sum' }]);
    expect(page?.partialFailure).toEqual([{ kind: 'gauge', error: 'boom' }]);
  });
});

describe('scanKindsForPage', () => {
  const never = (_kind: DiscoverableMetricKind, signal: AbortSignal) =>
    new Promise<string[]>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

  it('runs kinds in parallel', async () => {
    const started: DiscoverableMetricKind[] = [];
    const resolvers: Array<() => void> = [];
    const pageP = scanKindsForPage({
      kinds: ['gauge', 'sum'],
      limit: 10,
      deadlineAt: Date.now() + 5_000,
      signal: new AbortController().signal,
      fetchNames: kind => {
        started.push(kind);
        return new Promise(resolve => resolvers.push(() => resolve([kind])));
      },
    });
    expect(started).toEqual(['gauge', 'sum']);
    resolvers.forEach(r => r());
    expect((await pageP).entries.map(e => e.name)).toEqual(['gauge', 'sum']);
  });

  it('resolves and aborts later kinds once an earlier kind fills the page', async () => {
    let sumSignal: AbortSignal | undefined;
    const page = await scanKindsForPage({
      kinds: ['gauge', 'sum'],
      limit: 1,
      deadlineAt: Date.now() + 5_000,
      signal: new AbortController().signal,
      fetchNames: (kind, signal) => {
        if (kind === 'gauge') return Promise.resolve(['a', 'b']);
        sumSignal = signal;
        return never(kind, signal);
      },
    });
    expect(page.entries).toEqual([{ name: 'a', kind: 'gauge' }]);
    expect(page.next).toEqual({ kind: 'gauge', lastName: 'a' });
    expect(page.partialFailure).toEqual([]);
    expect(sumSignal?.aborted).toBe(true);
  });

  it('returns finished kinds and marks the rest timed out at the deadline', async () => {
    const page = await scanKindsForPage({
      kinds: ['gauge', 'sum', 'histogram'],
      limit: 10,
      deadlineAt: Date.now() + 50,
      signal: new AbortController().signal,
      fetchNames: (kind, signal) =>
        kind === 'sum' ? never(kind, signal) : Promise.resolve([kind]),
    });
    expect(page.entries.map(e => e.name)).toEqual(['gauge', 'histogram']);
    expect(page.partialFailure).toEqual([
      { kind: 'sum', error: KIND_TIMED_OUT_ERROR },
    ]);
  });
});
