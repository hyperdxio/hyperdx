import type { TSource } from '@hyperdx/common-utils/dist/types';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { resolveSearchOrderBy } from '@/utils/searchOrderBy';

const logSource: TSource = {
  id: 'log-source',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'connection',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
};

const traceSource: TSource = {
  id: 'trace-source',
  name: 'Traces',
  kind: SourceKind.Trace,
  connection: 'connection',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, SpanName',
  durationExpression: 'Duration',
  durationPrecision: 3,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
};

describe('resolveSearchOrderBy', () => {
  it('prefers and trims the caller override', () => {
    expect(
      resolveSearchOrderBy(
        { ...logSource, orderByExpression: 'Timestamp DESC' },
        ' SeverityText ASC ',
      ),
    ).toBe('SeverityText ASC');
  });

  it('uses a source order when no caller override is set', () => {
    expect(
      resolveSearchOrderBy({
        ...traceSource,
        orderByExpression: 'Duration ASC',
      }),
    ).toBe('Duration ASC');
  });

  it('builds a tuple from multi-part timestamp expressions', () => {
    expect(
      resolveSearchOrderBy({
        ...logSource,
        timestampValueExpression: 'TimestampTime, Timestamp',
      }),
    ).toBe('(TimestampTime, Timestamp) DESC');
  });

  it('appends and deduplicates the displayed timestamp expression', () => {
    expect(
      resolveSearchOrderBy({
        ...traceSource,
        timestampValueExpression: 'TimestampTime, Timestamp',
        displayedTimestampValueExpression: 'ObservedTimestamp',
      }),
    ).toBe('(TimestampTime, Timestamp, ObservedTimestamp) DESC');
    expect(
      resolveSearchOrderBy({
        ...traceSource,
        timestampValueExpression: 'TimestampTime, Timestamp',
        displayedTimestampValueExpression: 'Timestamp',
      }),
    ).toBe('(TimestampTime, Timestamp) DESC');
  });

  it('falls back to Timestamp when no timestamp expression is available', () => {
    expect(
      resolveSearchOrderBy({ ...logSource, timestampValueExpression: '' }),
    ).toBe('Timestamp DESC');
  });
});
