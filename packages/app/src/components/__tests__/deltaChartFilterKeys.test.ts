import {
  flattenedKeyToFilterKey,
  flattenedKeyToSqlExpression,
} from '../deltaChartUtils';

const traceColumnMeta = [
  { name: 'Timestamp', type: 'DateTime64(9)' },
  { name: 'TraceId', type: 'String' },
  { name: 'SpanId', type: 'String' },
  { name: 'ParentSpanId', type: 'String' },
  { name: 'ResourceAttributes', type: 'Map(String, String)' },
  { name: 'SpanAttributes', type: 'Map(String, String)' },
  { name: 'Events.Timestamp', type: 'Array(DateTime64(9))' },
  { name: 'Events.Name', type: 'Array(String)' },
  { name: 'Events.Attributes', type: 'Array(Map(String, String))' },
  { name: 'Links.TraceId', type: 'Array(String)' },
  { name: 'Links.SpanId', type: 'Array(String)' },
  { name: 'Links.Timestamp', type: 'Array(DateTime64(9))' },
  { name: 'Links.Attributes', type: 'Array(Map(String, String))' },
];

describe('flattenedKeyToSqlExpression', () => {
  it('converts Map column dot-notation to bracket notation', () => {
    expect(
      flattenedKeyToSqlExpression(
        'ResourceAttributes.service.name',
        traceColumnMeta,
      ),
    ).toBe("ResourceAttributes['service.name']");
  });

  it('converts SpanAttributes dot-notation to bracket notation', () => {
    expect(
      flattenedKeyToSqlExpression(
        'SpanAttributes.http.method',
        traceColumnMeta,
      ),
    ).toBe("SpanAttributes['http.method']");
  });

  it('converts Array(Map) dot-notation with 0-based index to 1-based bracket notation', () => {
    expect(
      flattenedKeyToSqlExpression(
        'Events.Attributes[0].message.type',
        traceColumnMeta,
      ),
    ).toBe("Events.Attributes[1]['message.type']");
  });

  it('increments the array index from 0-based JS to 1-based ClickHouse', () => {
    expect(
      flattenedKeyToSqlExpression('Events.Attributes[4].key', traceColumnMeta),
    ).toBe("Events.Attributes[5]['key']");
  });

  it('returns simple columns unchanged', () => {
    expect(flattenedKeyToSqlExpression('TraceId', traceColumnMeta)).toBe(
      'TraceId',
    );
  });

  it('returns non-map nested columns unchanged', () => {
    expect(flattenedKeyToSqlExpression('Events.Name[0]', traceColumnMeta)).toBe(
      'Events.Name[0]',
    );
  });

  it('returns key unchanged when no matching column found', () => {
    expect(
      flattenedKeyToSqlExpression('SomeUnknownColumn.key', traceColumnMeta),
    ).toBe('SomeUnknownColumn.key');
  });

  it('handles LowCardinality(Map) wrapped types', () => {
    const meta = [
      { name: 'LogAttributes', type: 'LowCardinality(Map(String, String))' },
    ];
    expect(flattenedKeyToSqlExpression('LogAttributes.level', meta)).toBe(
      "LogAttributes['level']",
    );
  });

  it('returns key unchanged for empty columnMeta', () => {
    expect(
      flattenedKeyToSqlExpression('ResourceAttributes.service.name', []),
    ).toBe('ResourceAttributes.service.name');
  });

  it('escapes single quotes in Map column keys to prevent SQL injection', () => {
    expect(
      flattenedKeyToSqlExpression(
        "ResourceAttributes.it's.key",
        traceColumnMeta,
      ),
    ).toBe("ResourceAttributes['it''s.key']");
  });

  it('escapes single quotes in Array(Map) column keys', () => {
    expect(
      flattenedKeyToSqlExpression(
        "Events.Attributes[0].it's.key",
        traceColumnMeta,
      ),
    ).toBe("Events.Attributes[1]['it''s.key']");
  });
});

describe('flattenedKeyToFilterKey', () => {
  it('converts Map column keys to bracket notation', () => {
    expect(
      flattenedKeyToFilterKey(
        'ResourceAttributes.service.name',
        traceColumnMeta,
      ),
    ).toBe("ResourceAttributes['service.name']");
  });

  it('handles multi-segment dotted Map keys as single bracket key', () => {
    expect(
      flattenedKeyToFilterKey(
        'ResourceAttributes.service.instance.id',
        traceColumnMeta,
      ),
    ).toBe("ResourceAttributes['service.instance.id']");
  });

  it('escapes single quotes in Map keys', () => {
    expect(
      flattenedKeyToFilterKey("ResourceAttributes.it's.key", traceColumnMeta),
    ).toBe("ResourceAttributes['it''s.key']");
  });

  it('returns simple columns unchanged', () => {
    expect(flattenedKeyToFilterKey('TraceId', traceColumnMeta)).toBe('TraceId');
  });

  it('returns simple columns unchanged for non-Map types', () => {
    expect(flattenedKeyToFilterKey('Timestamp', traceColumnMeta)).toBe(
      'Timestamp',
    );
  });
});
