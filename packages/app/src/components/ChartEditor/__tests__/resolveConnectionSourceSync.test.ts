import { resolveConnectionSourceSync } from '@/components/ChartEditor/RawSqlChartEditor';

const sources = [
  { id: 'src-a', connection: 'conn-1' },
  { id: 'src-b', connection: 'conn-2' },
];

describe('resolveConnectionSourceSync', () => {
  it('returns null while sources are still loading', () => {
    expect(
      resolveConnectionSourceSync({
        source: 'src-a',
        connection: undefined,
        prevSource: undefined,
        prevConnection: undefined,
        sources: undefined,
      }),
    ).toBeNull();
  });

  it('syncs the connection to match a newly selected source', () => {
    // Switching from builder → SQL: the source carried over on mount and the
    // connection field is still empty.
    expect(
      resolveConnectionSourceSync({
        source: 'src-a',
        connection: undefined,
        prevSource: undefined,
        prevConnection: undefined,
        sources,
      }),
    ).toEqual({ field: 'connection', value: 'conn-1' });
  });

  it('does NOT clear the source after a source-driven connection change', () => {
    // Regression: entering SQL mode with a leftover connection (conn-1) that
    // differs from the carried-over source's connection (conn-2). Render 1
    // syncs the connection to conn-2; render 2 must not then wipe the source.
    const render1 = resolveConnectionSourceSync({
      source: 'src-b',
      connection: 'conn-1',
      prevSource: undefined,
      prevConnection: undefined,
      sources,
    });
    expect(render1).toEqual({ field: 'connection', value: 'conn-2' });

    // Render 2: connection just changed to conn-2 (matching src-b), source
    // unchanged. The source belongs to the new connection, so keep it.
    const render2 = resolveConnectionSourceSync({
      source: 'src-b',
      connection: 'conn-2',
      prevSource: 'src-b',
      prevConnection: 'conn-1',
      sources,
    });
    expect(render2).toBeNull();
  });

  it('clears the source when the user picks a connection it does not belong to', () => {
    // User manually changes the connection dropdown from conn-1 to conn-2 while
    // src-a (conn-1) is selected. The source no longer belongs to the
    // connection, so it must be cleared.
    expect(
      resolveConnectionSourceSync({
        source: 'src-a',
        connection: 'conn-2',
        prevSource: 'src-a',
        prevConnection: 'conn-1',
        sources,
      }),
    ).toEqual({ field: 'source', value: '' });
  });

  it('does not clear an empty source when the connection changes', () => {
    expect(
      resolveConnectionSourceSync({
        source: '',
        connection: 'conn-2',
        prevSource: '',
        prevConnection: 'conn-1',
        sources,
      }),
    ).toBeNull();
  });

  it('sets a default connection when none is selected and source is empty', () => {
    expect(
      resolveConnectionSourceSync({
        source: '',
        connection: undefined,
        prevSource: '',
        prevConnection: undefined,
        sources,
      }),
    ).toEqual({ field: 'connection', value: 'conn-1' });
  });

  it('does nothing when the selected source already matches the connection', () => {
    expect(
      resolveConnectionSourceSync({
        source: 'src-a',
        connection: 'conn-1',
        prevSource: undefined,
        prevConnection: undefined,
        sources,
      }),
    ).toBeNull();
  });
});
