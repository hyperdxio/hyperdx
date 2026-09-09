import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';

import {
  createCompactWithNamesAndTypesParser,
  createEachRowWithProgressParser,
  StreamHandlers,
} from '@/utils/clickhouseStream';

function createHandlers() {
  return {
    onMeta: jest.fn(),
    onRows: jest.fn(),
    onProgress: jest.fn(),
  } satisfies StreamHandlers as jest.Mocked<Required<StreamHandlers>>;
}

describe('createCompactWithNamesAndTypesParser', () => {
  it('reads the name and type header lines before emitting rows', () => {
    const handlers = createHandlers();
    const parse = createCompactWithNamesAndTypesParser(handlers);

    parse([
      ['Timestamp', 'Body'],
      ['DateTime', 'String'],
      ['2024-01-01T00:00:00Z', 'hello'],
    ]);

    expect(handlers.onMeta).toHaveBeenCalledWith([
      { name: 'Timestamp', type: 'DateTime' },
      { name: 'Body', type: 'String' },
    ]);
    expect(handlers.onRows).toHaveBeenCalledWith([
      { Timestamp: '2024-01-01T00:00:00Z', Body: 'hello' },
    ]);
  });

  it('buffers header lines that arrive across separate batches', () => {
    const handlers = createHandlers();
    const parse = createCompactWithNamesAndTypesParser(handlers);

    parse([['Timestamp']]);
    expect(handlers.onMeta).not.toHaveBeenCalled();

    parse([['DateTime'], ['2024-01-01T00:00:00Z']]);

    expect(handlers.onMeta).toHaveBeenCalledWith([
      { name: 'Timestamp', type: 'DateTime' },
    ]);
    expect(handlers.onRows).toHaveBeenCalledWith([
      { Timestamp: '2024-01-01T00:00:00Z' },
    ]);
  });

  it('emits meta but no rows for an empty result set', () => {
    const handlers = createHandlers();
    const parse = createCompactWithNamesAndTypesParser(handlers);

    parse([['Body'], ['String']]);

    expect(handlers.onMeta).toHaveBeenCalledTimes(1);
    expect(handlers.onRows).not.toHaveBeenCalled();
  });

  it('reads meta only once across batches', () => {
    const handlers = createHandlers();
    const parse = createCompactWithNamesAndTypesParser(handlers);

    parse([['Body'], ['String'], ['a']]);
    parse([['b']]);

    expect(handlers.onMeta).toHaveBeenCalledTimes(1);
    expect(handlers.onRows).toHaveBeenNthCalledWith(1, [{ Body: 'a' }]);
    expect(handlers.onRows).toHaveBeenNthCalledWith(2, [{ Body: 'b' }]);
  });

  it('throws when the header lines disagree on column count', () => {
    const parse = createCompactWithNamesAndTypesParser(createHandlers());

    expect(() => parse([['a', 'b'], ['String']])).toThrow(
      'Invalid JSONCompactEachRowWithNamesAndTypes header rows',
    );
  });
});

describe('createEachRowWithProgressParser', () => {
  const QUERY = 'SELECT 1';

  it('routes meta, row, and progress events to their handlers', () => {
    const handlers = createHandlers();
    const parse = createEachRowWithProgressParser(handlers, QUERY);

    parse([
      { meta: [{ name: 'Body', type: 'String' }] },
      { row: { Body: 'hello' } },
      {
        progress: {
          read_rows: '100',
          read_bytes: '2048',
          total_rows_to_read: '1000',
          elapsed_ns: '5000000',
        },
      },
    ]);

    expect(handlers.onMeta).toHaveBeenCalledWith([
      { name: 'Body', type: 'String' },
    ]);
    expect(handlers.onRows).toHaveBeenCalledWith([{ Body: 'hello' }]);
    expect(handlers.onProgress).toHaveBeenCalledWith({
      read_rows: '100',
      read_bytes: '2048',
      total_rows_to_read: '1000',
      elapsed_ns: '5000000',
    });
  });

  it('accepts progress before meta', () => {
    const handlers = createHandlers();
    const parse = createEachRowWithProgressParser(handlers, QUERY);

    // ClickHouse writes progress straight from its progress callback, without
    // first emitting the format prefix, so this ordering is expected.
    parse([
      { progress: { read_rows: '10', read_bytes: '64', elapsed_ns: '1000' } },
    ]);
    parse([{ meta: [{ name: 'Body', type: 'String' }] }]);

    expect(handlers.onProgress).toHaveBeenCalledTimes(1);
    expect(handlers.onMeta).toHaveBeenCalledTimes(1);
    expect(handlers.onRows).not.toHaveBeenCalled();
  });

  it('batches consecutive rows into a single onRows call', () => {
    const handlers = createHandlers();
    const parse = createEachRowWithProgressParser(handlers, QUERY);

    parse([{ row: { n: 1 } }, { row: { n: 2 } }, { row: { n: 3 } }]);

    expect(handlers.onRows).toHaveBeenCalledTimes(1);
    expect(handlers.onRows).toHaveBeenCalledWith([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
  });

  it('ignores rows_before_limit_at_least, totals, and extremes events', () => {
    const handlers = createHandlers();
    const parse = createEachRowWithProgressParser(handlers, QUERY);

    parse([
      { rows_before_limit_at_least: 500 },
      { totals: { n: 6 } },
      { min: { n: 1 } },
      { max: { n: 3 } },
    ]);

    expect(handlers.onRows).not.toHaveBeenCalled();
    expect(handlers.onMeta).not.toHaveBeenCalled();
    expect(handlers.onProgress).not.toHaveBeenCalled();
  });

  it('throws a ClickHouseQueryError on a mid-stream exception event', () => {
    const handlers = createHandlers();
    const parse = createEachRowWithProgressParser(handlers, QUERY);

    expect(() =>
      parse([{ exception: 'Code: 241. DB::Exception: Memory limit exceeded' }]),
    ).toThrow(ClickHouseQueryError);
  });

  it('emits rows decoded before an exception so partial results survive', () => {
    const handlers = createHandlers();
    const parse = createEachRowWithProgressParser(handlers, QUERY);

    expect(() =>
      parse([{ row: { n: 1 } }, { exception: 'Code: 159. Timeout exceeded' }]),
    ).toThrow('Code: 159. Timeout exceeded');

    expect(handlers.onRows).toHaveBeenCalledWith([{ n: 1 }]);
  });

  it('carries the query text on the thrown error for debugging', () => {
    const parse = createEachRowWithProgressParser(createHandlers(), QUERY);

    try {
      parse([{ exception: 'boom' }]);
      throw new Error('expected parse to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ClickHouseQueryError);
      expect((e as ClickHouseQueryError).query).toBe(QUERY);
    }
  });

  it('tolerates a missing onProgress handler', () => {
    const onMeta = jest.fn();
    const onRows = jest.fn();
    const parse = createEachRowWithProgressParser({ onMeta, onRows }, QUERY);

    expect(() =>
      parse([
        { progress: { read_rows: '1', read_bytes: '1', elapsed_ns: '1' } },
      ]),
    ).not.toThrow();
  });
});
