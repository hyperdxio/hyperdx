import { resolveTraceScope } from '@/core/traceScope';
import { SourceKind, TSource } from '@/types';

const makeTraceSource = (overrides: Record<string, unknown> = {}): TSource =>
  ({
    id: 'trace-source-1',
    kind: SourceKind.Trace,
    name: 'traces',
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
    traceIdExpression: 'TraceId',
    ...overrides,
  }) as unknown as TSource;

const makeLogSource = (overrides: Record<string, unknown> = {}): TSource =>
  ({
    id: 'log-source-1',
    kind: SourceKind.Log,
    name: 'logs',
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'TimestampTime',
    ...overrides,
  }) as unknown as TSource;

describe('resolveTraceScope', () => {
  it('resolves a trace source with a valid traceIdExpression as applicable @AC-FR005-01', () => {
    const source = makeTraceSource({ traceIdExpression: 'TraceId' });

    expect(resolveTraceScope(source)).toEqual({
      applicable: true,
      traceIdExpression: 'TraceId',
    });
  });

  it('trims surrounding whitespace from the resolved traceIdExpression @AC-FR005-01', () => {
    const source = makeTraceSource({ traceIdExpression: '  TraceId  ' });

    expect(resolveTraceScope(source)).toEqual({
      applicable: true,
      traceIdExpression: 'TraceId',
    });
  });

  it('rejects a non-trace source with reason non-trace-source @AC-FR005-01', () => {
    expect(resolveTraceScope(makeLogSource())).toEqual({
      applicable: false,
      reason: 'non-trace-source',
    });
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])(
    'fails closed on a trace source whose traceIdExpression is %s @AC-FR005-04',
    (_label, traceIdExpression) => {
      const source = makeTraceSource({ traceIdExpression });

      expect(resolveTraceScope(source)).toEqual({
        applicable: false,
        reason: 'missing-trace-id-expression',
      });
    },
  );

  it('is pure: repeated calls return equal results and do not mutate the source @AC-FR005-04', () => {
    const source = makeTraceSource({ traceIdExpression: 'TraceId' });
    const snapshot = JSON.stringify(source);

    const first = resolveTraceScope(source);
    const second = resolveTraceScope(source);

    expect(first).toEqual(second);
    expect(JSON.stringify(source)).toEqual(snapshot);
  });
});
