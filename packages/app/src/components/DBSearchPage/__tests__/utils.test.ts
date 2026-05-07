import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import {
  buildHistogramTimeChartConfig,
  generateSearchUrl,
  getDefaultSourceId,
  optimizeDefaultOrderBy,
  parseDisplayedColumns,
  toggleColumnInSelect,
} from '../utils';

describe('getDefaultSourceId', () => {
  it('returns empty string if sources is undefined', () => {
    expect(getDefaultSourceId(undefined, undefined)).toBe('');
  });

  it('returns empty string if sources is empty', () => {
    expect(getDefaultSourceId([], undefined)).toBe('');
  });

  it('returns empty string if sources is empty but lastSelectedSourceId is a string', () => {
    expect(getDefaultSourceId([], 'some-id')).toBe('');
  });

  it('returns lastSelectedSourceId if it exists in sources', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(getDefaultSourceId(sources, 'b')).toBe('b');
  });

  it('returns first source id if lastSelectedSourceId is not in sources', () => {
    const sources = [{ id: 'a' }, { id: 'b' }];
    expect(getDefaultSourceId(sources, 'z')).toBe('a');
  });

  it('returns first source id if lastSelectedSourceId is undefined', () => {
    const sources = [{ id: 'x' }, { id: 'y' }];
    expect(getDefaultSourceId(sources, undefined)).toBe('x');
  });
});

describe('optimizeDefaultOrderBy', () => {
  const cases = [
    {
      name: 'returns Timestamp DESC for empty sortingKey',
      ts: 'Timestamp',
      displayed: undefined,
      sk: '',
      expected: 'Timestamp DESC',
    },
    {
      name: 'extracts time-prefixed columns from a multi-column sortingKey',
      ts: 'Timestamp',
      displayed: undefined,
      sk: 'ServiceName, SpanName, toDateTime(Timestamp)',
      expected: '(toDateTime(Timestamp), Timestamp) DESC',
    },
    {
      name: 'preserves the order of toStartOf-prefixed expressions before Timestamp',
      ts: 'Timestamp',
      displayed: undefined,
      sk: 'toStartOfHour(Timestamp), other_column, Timestamp',
      expected: '(toStartOfHour(Timestamp), Timestamp) DESC',
    },
    {
      name: 'includes displayedTimestampValueExpression even when not in sortingKey',
      ts: 'Timestamp',
      displayed: 'Timestamp64',
      sk: 'SomeOtherTimeColumn',
      expected: '(Timestamp, Timestamp64) DESC',
    },
    {
      name: 'trims displayedTimestampValueExpression whitespace',
      ts: 'Timestamp',
      displayed: 'Timestamp64 ',
      sk: 'Timestamp',
      expected: '(Timestamp, Timestamp64) DESC',
    },
    {
      name: 'reorders sorting key parts to follow timestampValueExpression order',
      ts: 'TimestampTime, Timestamp',
      displayed: undefined,
      sk: 'ServiceName, TimestampTime, Timestamp',
      expected: '(TimestampTime, Timestamp) DESC',
    },
    {
      name: 'handles nested time expressions',
      ts: 'toDateTime(timestamp_ms / 1000)',
      displayed: undefined,
      sk: 'toStartOfHour(toDateTime(timestamp_ms / 1000)), toDateTime(timestamp_ms / 1000)',
      expected:
        '(toStartOfHour(toDateTime(timestamp_ms / 1000)), toDateTime(timestamp_ms / 1000)) DESC',
    },
  ];
  for (const tc of cases) {
    it(tc.name, () => {
      expect(optimizeDefaultOrderBy(tc.ts, tc.displayed, tc.sk)).toBe(
        tc.expected,
      );
    });
  }
});

describe('parseDisplayedColumns', () => {
  it('returns empty array when both inputs are undefined', () => {
    expect(parseDisplayedColumns(undefined, undefined)).toEqual([]);
  });

  it('falls back to defaultSelect only when rawSelect is undefined', () => {
    expect(parseDisplayedColumns(undefined, 'a, b')).toEqual(['a', 'b']);
  });

  it('keeps empty rawSelect (matches original ?? semantics)', () => {
    // The original DBSearchPage used `?? defaultSelect ?? ''` so an
    // explicit empty string is preserved (not replaced by defaultSelect).
    expect(parseDisplayedColumns('', 'a, b')).toEqual([]);
  });

  it('parses rawSelect when it is a string', () => {
    expect(parseDisplayedColumns('Timestamp, Body', undefined)).toEqual([
      'Timestamp',
      'Body',
    ]);
  });

  it('returns empty array when rawSelect is a non-string array', () => {
    expect(parseDisplayedColumns([], 'fallback')).toEqual([]);
  });

  it('respects bracket grouping', () => {
    expect(parseDisplayedColumns('foo, bar(a, b), baz', undefined)).toEqual([
      'foo',
      'bar(a, b)',
      'baz',
    ]);
  });
});

describe('toggleColumnInSelect', () => {
  it('adds column when not present', () => {
    expect(toggleColumnInSelect(['a', 'b'], 'c')).toBe('a, b, c');
  });

  it('removes column when already present', () => {
    expect(toggleColumnInSelect(['a', 'b', 'c'], 'b')).toBe('a, c');
  });

  it('handles empty list', () => {
    expect(toggleColumnInSelect([], 'a')).toBe('a');
  });
});

describe('generateSearchUrl', () => {
  const baseTimeRange: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];

  it('appends select/where/filters/source from current searched config when source is unchanged', () => {
    const url = generateSearchUrl({
      where: 'level = "error"',
      whereLanguage: 'lucene',
      source: undefined,
      searchedSource: { id: 's1' } as any,
      searchedConfig: {
        select: 'Timestamp',
        where: 'older where',
        filters: [],
      },
      searchedTimeRange: baseTimeRange,
      interval: 60_000,
    });
    expect(url).toContain('source=s1');
    expect(url).toContain('select=Timestamp');
    // URLSearchParams encodes spaces as '+' (form-urlencoded), not %20
    expect(url).toContain('where=level+%3D+%22error%22');
    expect(url).toContain('whereLanguage=lucene');
    expect(url).toContain('isLive=false');
    expect(url).toContain('liveInterval=60000');
  });

  it('switches to provided source and drops select/filters when source differs', () => {
    const url = generateSearchUrl({
      where: 'foo',
      whereLanguage: 'sql',
      source: { id: 's2' } as any,
      searchedSource: { id: 's1' } as any,
      searchedConfig: {
        select: 'Timestamp',
        where: 'old',
        filters: [],
      },
      searchedTimeRange: baseTimeRange,
      interval: 60_000,
    });
    expect(url).toContain('source=s2');
    expect(url).not.toContain('select=Timestamp');
    expect(url).toContain('where=foo');
  });

  it('falls back whereLanguage to "sql" when not supplied', () => {
    const url = generateSearchUrl({
      where: 'foo',
      whereLanguage: null,
      searchedSource: { id: 's1' } as any,
      searchedConfig: { select: '', where: '', filters: [] },
      searchedTimeRange: baseTimeRange,
      interval: 1000,
    });
    expect(url).toContain('whereLanguage=sql');
  });
});

describe('buildHistogramTimeChartConfig', () => {
  const baseChartConfig = {
    select: 'Timestamp',
    from: { databaseName: 'db', tableName: 'logs' },
    where: '',
    timestampValueExpression: 'Timestamp',
    connection: 'conn',
    displayType: DisplayType.Search,
  } as any;
  const dateRange: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];

  it('groups by severityTextExpression for log sources', () => {
    const result = buildHistogramTimeChartConfig({
      chartConfig: baseChartConfig,
      source: {
        kind: SourceKind.Log,
        severityTextExpression: 'SeverityText',
      } as any,
      aliasWith: [],
      searchedTimeRange: dateRange,
      isLive: false,
      eventTableSelect: 'Timestamp',
    });
    expect(result.groupBy).toBe('SeverityText');
    expect(result.displayType).toBe(DisplayType.StackedBar);
    expect(result.eventTableSelect).toBe('Timestamp');
    expect(result.alignDateRangeToGranularity).toBe(true);
    expect(result.dateRange).toEqual(dateRange);
  });

  it('groups by statusCodeExpression for trace sources', () => {
    const result = buildHistogramTimeChartConfig({
      chartConfig: baseChartConfig,
      source: {
        kind: SourceKind.Trace,
        statusCodeExpression: 'StatusCode',
      } as any,
      aliasWith: [],
      searchedTimeRange: dateRange,
      isLive: true,
      eventTableSelect: undefined,
    });
    expect(result.groupBy).toBe('StatusCode');
    // alignDateRangeToGranularity is false in live mode
    expect(result.alignDateRangeToGranularity).toBe(false);
  });

  it('omits groupBy when source is undefined', () => {
    const result = buildHistogramTimeChartConfig({
      chartConfig: baseChartConfig,
      source: undefined,
      aliasWith: [],
      searchedTimeRange: dateRange,
      isLive: false,
      eventTableSelect: undefined,
    });
    expect(result.groupBy).toBeUndefined();
  });
});
