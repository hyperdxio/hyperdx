import {
  assembleMetricsPage,
  KIND_TIMED_OUT_ERROR,
  type KindScan,
  type KindSlot,
  scanKindsForPage,
} from '@/mcp/tools/sources/listMetricsPage';
import type { DiscoverableMetricKind } from '@/mcp/tools/sources/metricKinds';

const ok = (...names: string[]): KindScan => ({ status: 'ok', names });
const pending: KindScan = { status: 'pending' };

const slots = (...scans: KindScan[]): KindSlot[] => {
  const kinds: DiscoverableMetricKind[] = ['gauge', 'sum', 'histogram'];
  return scans.map((scan, i) => ({ kind: kinds.at(i)!, scan }));
};

describe('assembleMetricsPage', () => {
  it('concatenates kinds in order when everything fits', () => {
    const page = assembleMetricsPage(
      slots(ok('a'), ok('b', 'c'), ok()),
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
      slots(ok('a'), ok('b', 'c', 'd'), pending),
      2,
      false,
    );
    expect(page?.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(page?.next).toEqual({ kind: 'sum', lastName: 'b' });
  });

  it('points the cursor at the next kind with names when an earlier kind exactly fills the page', () => {
    const page = assembleMetricsPage(
      slots(ok('a', 'b'), ok(), ok('c')),
      2,
      false,
    );
    expect(page?.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(page?.next).toEqual({ kind: 'histogram' });
  });

  it('returns a full page without waiting for later kinds', () => {
    const page = assembleMetricsPage(slots(ok('a', 'b'), pending), 2, false);
    expect(page?.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(page?.next).toEqual({ kind: 'sum' });
    expect(page?.partialFailure).toEqual([]);
  });

  it('emits no cursor when the page is full and later kinds are empty', () => {
    const page = assembleMetricsPage(slots(ok('a', 'b'), ok(), ok()), 2, false);
    expect(page?.next).toBeUndefined();
  });

  it('waits while a pending kind can still change the page', () => {
    expect(
      assembleMetricsPage(slots(ok('a'), pending, ok('b')), 10, false),
    ).toBeNull();
  });

  it('ends the page at a timed-out kind and resumes the cursor there', () => {
    const page = assembleMetricsPage(
      slots(ok('a'), pending, ok('b')),
      10,
      true,
    );
    expect(page?.entries.map(e => e.name)).toEqual(['a']);
    expect(page?.next).toEqual({ kind: 'sum' });
    expect(page?.partialFailure).toEqual([
      { kind: 'sum', error: KIND_TIMED_OUT_ERROR },
    ]);
  });

  it("resumes a timed-out cursor kind from the cursor's position", () => {
    const page = assembleMetricsPage(
      [{ kind: 'sum', afterName: 'm', scan: pending }],
      10,
      true,
    );
    expect(page?.entries).toEqual([]);
    expect(page?.next).toEqual({ kind: 'sum', lastName: 'm' });
  });

  it('skips failed kinds and records them', () => {
    const page = assembleMetricsPage(
      slots({ status: 'error', error: 'boom' }, ok('a'), ok()),
      10,
      false,
    );
    expect(page?.entries).toEqual([{ name: 'a', kind: 'sum' }]);
    expect(page?.partialFailure).toEqual([{ kind: 'gauge', error: 'boom' }]);
  });
});

describe('scanKindsForPage', () => {
  const never = (signal: AbortSignal) =>
    new Promise<string[]>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

  it('runs kinds in parallel', async () => {
    const started: DiscoverableMetricKind[] = [];
    const resolvers: Array<() => void> = [];
    const pageP = scanKindsForPage({
      kinds: [{ kind: 'gauge' }, { kind: 'sum' }],
      limit: 10,
      deadlineAt: Date.now() + 5_000,
      signal: new AbortController().signal,
      fetchNames: ({ kind }) => {
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
      kinds: [{ kind: 'gauge' }, { kind: 'sum' }],
      limit: 1,
      deadlineAt: Date.now() + 5_000,
      signal: new AbortController().signal,
      fetchNames: ({ kind }, signal) => {
        if (kind === 'gauge') return Promise.resolve(['a', 'b']);
        sumSignal = signal;
        return never(signal);
      },
    });
    expect(page.entries).toEqual([{ name: 'a', kind: 'gauge' }]);
    expect(page.next).toEqual({ kind: 'gauge', lastName: 'a' });
    expect(page.partialFailure).toEqual([]);
    expect(sumSignal?.aborted).toBe(true);
  });

  it('resolves immediately when there are no kinds to scan', async () => {
    const page = await scanKindsForPage({
      kinds: [],
      limit: 10,
      deadlineAt: Date.now() + 60_000,
      signal: new AbortController().signal,
      fetchNames: () => Promise.resolve([]),
    });
    expect(page).toEqual({ entries: [], partialFailure: [] });
  });

  it('returns kinds before a timed-out kind and resumes at it', async () => {
    const page = await scanKindsForPage({
      kinds: [{ kind: 'gauge' }, { kind: 'sum' }, { kind: 'histogram' }],
      limit: 10,
      deadlineAt: Date.now() + 50,
      signal: new AbortController().signal,
      fetchNames: ({ kind }, signal) =>
        kind === 'sum' ? never(signal) : Promise.resolve([kind]),
    });
    expect(page.entries.map(e => e.name)).toEqual(['gauge']);
    expect(page.next).toEqual({ kind: 'sum' });
    expect(page.partialFailure).toEqual([
      { kind: 'sum', error: KIND_TIMED_OUT_ERROR },
    ]);
  });
});
