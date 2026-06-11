import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';

import { buildPatternColumnExpression } from '../PatternColumnSelector';

function makeColumn(name: string, type: string): ColumnMeta {
  return {
    name,
    type,
    codec_expression: '',
    comment: '',
    default_expression: '',
    default_type: '',
    ttl_expression: '',
  };
}

describe('buildPatternColumnExpression', () => {
  const fallback = 'Body';

  it('returns the fallback when no pattern column is selected', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: null,
        fallback,
        columns: [makeColumn('Body', 'String')],
      }),
    ).toBe(fallback);

    expect(
      buildPatternColumnExpression({
        patternColumn: undefined,
        fallback,
        columns: [],
      }),
    ).toBe(fallback);

    expect(
      buildPatternColumnExpression({
        patternColumn: '',
        fallback,
        columns: [],
      }),
    ).toBe(fallback);
  });

  it('uses the column directly when it is a String type', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: 'ServiceName',
        fallback,
        columns: [makeColumn('ServiceName', 'String')],
      }),
    ).toBe('ServiceName');
  });

  it('uses the column directly when it is a LowCardinality(String) type', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: 'SeverityText',
        fallback,
        columns: [makeColumn('SeverityText', 'LowCardinality(String)')],
      }),
    ).toBe('SeverityText');
  });

  it('wraps non-string columns in toString()', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: 'ResourceAttributes',
        fallback,
        columns: [
          makeColumn(
            'ResourceAttributes',
            'Map(LowCardinality(String), String)',
          ),
        ],
      }),
    ).toBe('toString(ResourceAttributes)');

    expect(
      buildPatternColumnExpression({
        patternColumn: 'Timestamp',
        fallback,
        columns: [makeColumn('Timestamp', 'DateTime64(9)')],
      }),
    ).toBe('toString(Timestamp)');

    expect(
      buildPatternColumnExpression({
        patternColumn: 'SpanCount',
        fallback,
        columns: [makeColumn('SpanCount', 'UInt32')],
      }),
    ).toBe('toString(SpanCount)');
  });

  it('falls back to the raw column name when columns metadata is not loaded', () => {
    expect(
      buildPatternColumnExpression({
        patternColumn: 'CustomColumn',
        fallback,
        columns: undefined,
      }),
    ).toBe('CustomColumn');

    expect(
      buildPatternColumnExpression({
        patternColumn: 'MissingColumn',
        fallback,
        columns: [makeColumn('OtherColumn', 'String')],
      }),
    ).toBe('MissingColumn');
  });
});
