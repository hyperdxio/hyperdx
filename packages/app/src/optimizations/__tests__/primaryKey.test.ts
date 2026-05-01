import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { __testing, primaryKeyPlugin } from '../plugins/primaryKey';

const { detect, pkMatches, DEFAULTS } = __testing;

function makeLogSource(overrides: Partial<TSource> = {}): TSource {
  return {
    id: 'src-log',
    name: 'logs',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'db', tableName: 'logs' },
    timestampValueExpression: 'TimestampTime',
    defaultTableSelectExpression: 'Body',
    ...overrides,
  } as TSource;
}

function makeTraceSource(overrides: Partial<TSource> = {}): TSource {
  return {
    id: 'src-trace',
    name: 'traces',
    kind: SourceKind.Trace,
    connection: 'conn-1',
    from: { databaseName: 'db', tableName: 'traces' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'SpanName',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    ...overrides,
  } as TSource;
}

function makeMetadata({
  primaryKeyByTable,
}: {
  primaryKeyByTable: Record<string, string | undefined>;
}): Metadata {
  return {
    getTableMetadata: jest.fn(
      async ({
        databaseName,
        tableName,
      }: {
        databaseName: string;
        tableName: string;
      }) => {
        const pk = primaryKeyByTable[`${databaseName}.${tableName}`];
        if (pk === undefined) return undefined;
        return { primary_key: pk };
      },
    ),
  } as unknown as Metadata;
}

describe('primaryKeyPlugin', () => {
  it('emits a finding when a log source uses the default PK', async () => {
    const findings = await detect({
      sources: [makeLogSource()],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        primaryKeyByTable: { 'db.logs': DEFAULTS[SourceKind.Log].current },
      }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      scopeId: 'source:src-log',
      detail: {
        sourceId: 'src-log',
        currentPrimaryKey: DEFAULTS[SourceKind.Log].current,
        recommendedPrimaryKey: DEFAULTS[SourceKind.Log].recommended,
        sourceKind: SourceKind.Log,
      },
    });
  });

  it('emits a finding when a trace source uses the default PK', async () => {
    const findings = await detect({
      sources: [makeTraceSource()],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        primaryKeyByTable: {
          'db.traces': DEFAULTS[SourceKind.Trace].current,
        },
      }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      detail: {
        sourceKind: SourceKind.Trace,
        recommendedPrimaryKey: DEFAULTS[SourceKind.Trace].recommended,
      },
    });
  });

  it('does NOT emit when the user has customized the PK', async () => {
    const findings = await detect({
      sources: [makeLogSource(), makeTraceSource()],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        primaryKeyByTable: {
          'db.logs': 'toStartOfHour(Timestamp), ServiceName',
          'db.traces': 'TraceId',
        },
      }),
    });

    expect(findings).toHaveLength(0);
  });

  it('does NOT emit when the PK already matches the recommendation', async () => {
    const findings = await detect({
      sources: [makeLogSource()],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        primaryKeyByTable: {
          'db.logs': DEFAULTS[SourceKind.Log].recommended,
        },
      }),
    });

    expect(findings).toHaveLength(0);
  });

  it('matches the default PK regardless of whitespace differences', () => {
    expect(
      pkMatches('ServiceName,TimestampTime', 'ServiceName, TimestampTime'),
    ).toBe(true);
    expect(
      pkMatches(
        '  ServiceName ,  TimestampTime ',
        'ServiceName, TimestampTime',
      ),
    ).toBe(true);
    expect(
      pkMatches('ServiceName, OtherColumn', 'ServiceName, TimestampTime'),
    ).toBe(false);
  });

  it('skips sources for which getTableMetadata returns undefined', async () => {
    const findings = await detect({
      sources: [makeLogSource()],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({ primaryKeyByTable: {} }),
    });

    expect(findings).toHaveLength(0);
  });

  it('skips Session and Metric sources entirely', async () => {
    const sessionSource = {
      id: 'src-session',
      name: 'sessions',
      kind: SourceKind.Session,
      connection: 'conn-1',
      from: { databaseName: 'db', tableName: 'sessions' },
      timestampValueExpression: 'Timestamp',
    } as unknown as TSource;
    const metricSource = {
      id: 'src-metric',
      name: 'metrics',
      kind: SourceKind.Metric,
      connection: 'conn-1',
      from: { databaseName: 'db', tableName: 'metrics' },
      timestampValueExpression: 'TimeUnix',
    } as unknown as TSource;

    const getTableMetadata = jest.fn();
    const findings = await detect({
      sources: [sessionSource, metricSource],
      clickhouseClient: {} as ClickhouseClient,
      metadata: { getTableMetadata } as unknown as Metadata,
    });

    expect(findings).toHaveLength(0);
    expect(getTableMetadata).not.toHaveBeenCalled();
  });

  it('plugin omits buildDDL so the UI hides the Apply button', () => {
    expect(primaryKeyPlugin.buildDDL).toBeUndefined();
  });

  it('resolveSource looks up by sourceId', () => {
    const source = makeLogSource();
    const finding = {
      scopeId: 'source:src-log',
      summary: '',
      detail: {
        sourceId: 'src-log',
        databaseName: 'db',
        tableName: 'logs',
        currentPrimaryKey: 'a',
        recommendedPrimaryKey: 'b',
        sourceKind: SourceKind.Log as const,
      },
    };
    expect(primaryKeyPlugin.resolveSource?.(finding, [source])).toBe(source);
  });
});
