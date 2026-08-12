import {
  summarizeRows,
  TileDeadlineError,
  withDeadline,
} from '@/mcp/tools/dashboards/queryTiles';

describe('summarizeRows', () => {
  it('reads a top-level array result as rows', () => {
    const text = JSON.stringify({ result: [{ a: 1 }, { a: 2 }] });
    expect(summarizeRows(text)).toEqual({ hasData: true, rowCount: 2 });
  });

  it('reads a { data: [...] } result as rows', () => {
    const text = JSON.stringify({ result: { data: [{ a: 1 }] } });
    expect(summarizeRows(text)).toEqual({ hasData: true, rowCount: 1 });
  });

  it('reports hasData=false and rowCount=0 for an empty result set', () => {
    expect(summarizeRows(JSON.stringify({ result: [] }))).toEqual({
      hasData: false,
      rowCount: 0,
    });
    expect(summarizeRows(JSON.stringify({ result: { data: [] } }))).toEqual({
      hasData: false,
      rowCount: 0,
    });
  });

  it('returns {} for a payload whose result is not row-shaped', () => {
    // result present but neither an array nor a { data: [] } object.
    expect(
      summarizeRows(JSON.stringify({ result: { note: 'trimmed' } })),
    ).toEqual({});
    // no result key at all.
    expect(summarizeRows(JSON.stringify({ warnings: ['x'] }))).toEqual({});
  });

  it('returns {} for unparseable text', () => {
    expect(summarizeRows('not json')).toEqual({});
    expect(summarizeRows('')).toEqual({});
  });

  it('returns {} for JSON primitives (null / number)', () => {
    // Valid JSON, but not an object with a `result` key.
    expect(summarizeRows('null')).toEqual({});
    expect(summarizeRows('123')).toEqual({});
  });
});

describe('withDeadline', () => {
  it('resolves work that finishes before the deadline', async () => {
    await expect(withDeadline(Promise.resolve('done'), 1000)).resolves.toBe(
      'done',
    );
  });

  it('rejects with TileDeadlineError when work exceeds the deadline', async () => {
    const slow = new Promise<string>(resolve =>
      setTimeout(() => resolve('too late'), 50),
    );
    await expect(withDeadline(slow, 5)).rejects.toBeInstanceOf(
      TileDeadlineError,
    );
  });

  it('propagates a rejection from the underlying work', async () => {
    const boom = Promise.reject(new Error('boom'));
    await expect(withDeadline(boom, 1000)).rejects.toThrow('boom');
  });
});
