import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TLogSource,
  TMetricSource,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  buildReleaseChartConfig,
  canDeriveReleases,
  DEFAULT_VERSION_EXPRESSION,
  releaseRowsToAnnotations,
  resolveVersionExpression,
  useReleaseAnnotations,
} from '@/hooks/useReleaseAnnotations';
import { getChartColorInfo } from '@/utils';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

// Untyped handle on the mocked hook. Going through the module object keeps the
// mock's argument and return types loose, so the fixtures below don't need
// `as any` casts to stand in for a full react-query result.
const chartConfigModule: { useQueriedChartConfig: jest.Mock } =
  jest.requireMock('@/hooks/useChartConfig');
const mockedUseQueriedChartConfig = chartConfigModule.useQueriedChartConfig;

// Fully-formed sources, typed as their concrete kind rather than asserted, so
// a schema change surfaces here instead of being silently cast away.
const logSource: TLogSource = {
  id: 'log-1',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'TimestampTime',
  defaultTableSelectExpression: 'Timestamp, Body',
  serviceNameExpression: 'ServiceName',
  implicitColumnExpression: 'Body',
};

const traceSource: TTraceSource = {
  id: 'trace-1',
  name: 'Traces',
  kind: SourceKind.Trace,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, SpanName',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  serviceNameExpression: 'ServiceName',
};

const metricSource: TMetricSource = {
  id: 'metric-1',
  name: 'Metrics',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    histogram: 'otel_metrics_histogram',
    sum: 'otel_metrics_sum',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exponential_histogram',
  },
};

const sessionSource: TSessionSource = {
  id: 'session-1',
  name: 'Sessions',
  kind: SourceKind.Session,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
  timestampValueExpression: 'TimestampTime',
  traceSourceId: 'trace-1',
};

describe('canDeriveReleases', () => {
  it('accepts log and trace sources', () => {
    expect(canDeriveReleases(logSource)).toBe(true);
    expect(canDeriveReleases(traceSource)).toBe(true);
  });

  // The deployments query re-aggregates the tile's own table, which is what
  // makes the tile's filters meaningful against it. Metric sources resolve
  // their table per metric type, so there is no single table to re-aggregate.
  it('rejects metric, session and disabled sources', () => {
    expect(canDeriveReleases(metricSource)).toBe(false);
    expect(canDeriveReleases(sessionSource)).toBe(false);
    expect(canDeriveReleases({ ...logSource, disabled: true })).toBe(false);
  });

  it('rejects a missing source', () => {
    expect(canDeriveReleases(undefined)).toBe(false);
  });
});

describe('resolveVersionExpression', () => {
  it('falls back to the OTel service.version resource attribute', () => {
    expect(resolveVersionExpression(logSource)).toBe(
      DEFAULT_VERSION_EXPRESSION,
    );
    expect(resolveVersionExpression(undefined)).toBe(
      DEFAULT_VERSION_EXPRESSION,
    );
  });

  // The point of the setting: GitOps teams whose release identifier is a
  // container image tag shouldn't have to change instrumentation.
  it("uses the source's own expression when configured", () => {
    expect(
      resolveVersionExpression({
        ...logSource,
        serviceVersionExpression: "ResourceAttributes['container.image.tag']",
      }),
    ).toBe("ResourceAttributes['container.image.tag']");
  });

  it('works on trace sources too', () => {
    expect(
      resolveVersionExpression({
        ...traceSource,
        serviceVersionExpression: "SpanAttributes['release']",
      }),
    ).toBe("SpanAttributes['release']");
  });

  it('treats a blank expression as unset', () => {
    expect(
      resolveVersionExpression({
        ...logSource,
        serviceVersionExpression: '  ',
      }),
    ).toBe(DEFAULT_VERSION_EXPRESSION);
  });

  // Metric and session sources have no such field; it must not throw.
  it('falls back for sources that cannot carry the field', () => {
    expect(resolveVersionExpression(metricSource)).toBe(
      DEFAULT_VERSION_EXPRESSION,
    );
    expect(resolveVersionExpression(sessionSource)).toBe(
      DEFAULT_VERSION_EXPRESSION,
    );
  });
});

describe('buildReleaseChartConfig', () => {
  const range: [Date, Date] = [new Date(1_000), new Date(2_000)];

  it('selects the first timestamp each version was seen at, grouped by version and service', () => {
    const config = buildReleaseChartConfig(
      logSource,
      DEFAULT_VERSION_EXPRESSION,
      range,
    );

    expect(config.select).toBe(
      "min(TimestampTime) AS firstSeen, ResourceAttributes['service.version'] AS version, ServiceName AS service",
    );
    expect(config.groupBy).toBe(
      "ResourceAttributes['service.version'], ServiceName",
    );
    expect(config.where).toBe("ResourceAttributes['service.version'] != ''");
    expect(config.whereLanguage).toBe('sql');
    expect(config.orderBy).toBe('firstSeen ASC');
    expect(config.limit).toEqual({ limit: 500 });
    expect(config.dateRange).toBe(range);
    expect(config.source).toBe('log-1');
    expect(config.from).toBe(logSource.from);
  });

  // The group-by columns are already named in `select`; leaving this unset
  // makes renderChartConfig append them a second time.
  it('disables automatic group-by projection', () => {
    expect(
      buildReleaseChartConfig(logSource, DEFAULT_VERSION_EXPRESSION, range)
        .selectGroupBy,
    ).toBe(false);
  });

  it('omits the service column when the source has no service expression', () => {
    const noService = { ...logSource, serviceNameExpression: undefined };
    const config = buildReleaseChartConfig(
      noService,
      DEFAULT_VERSION_EXPRESSION,
      range,
    );

    expect(config.select).toBe(
      "min(TimestampTime) AS firstSeen, ResourceAttributes['service.version'] AS version",
    );
    expect(config.groupBy).toBe("ResourceAttributes['service.version']");
  });

  it('uses only the first expression of a multi-column timestamp', () => {
    const multi = {
      ...logSource,
      timestampValueExpression: 'TimestampTime, Timestamp',
    };

    expect(
      buildReleaseChartConfig(multi, DEFAULT_VERSION_EXPRESSION, range).select,
    ).toContain('min(TimestampTime) AS firstSeen');
  });

  it('honors a custom version expression', () => {
    const config = buildReleaseChartConfig(
      logSource,
      "LogAttributes['release']",
      range,
    );

    expect(config.select).toContain("LogAttributes['release'] AS version");
    expect(config.groupBy).toContain("LogAttributes['release']");
    expect(config.where).toBe("LogAttributes['release'] != ''");
  });

  describe('tile scoping', () => {
    it('sends no filters when the tile is unfiltered', () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
        { where: '   ', filters: [] },
      );

      expect(config.filters).toBeUndefined();
    });

    // The whole point: a tile filtered to one service must not be annotated
    // with another service's releases.
    it("carries the tile's own where clause as a filter", () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
        { where: 'ServiceName:"checkout"', whereLanguage: 'lucene' },
      );

      expect(config.filters).toEqual([
        { type: 'lucene', condition: 'ServiceName:"checkout"' },
      ]);
      // The config's own `where` stays reserved for the SQL version predicate.
      expect(config.where).toBe("ResourceAttributes['service.version'] != ''");
    });

    it('preserves a SQL tile where clause as a SQL filter', () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
        { where: "ServiceName = 'checkout'", whereLanguage: 'sql' },
      );

      expect(config.filters).toEqual([
        { type: 'sql', condition: "ServiceName = 'checkout'" },
      ]);
    });

    it('appends dashboard filters and drops empty ones', () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
        {
          where: 'ServiceName:"checkout"',
          whereLanguage: 'lucene',
          filters: [
            { type: 'lucene', condition: '' },
            { type: 'sql', condition: "Env = 'prod'" },
          ],
        },
      );

      expect(config.filters).toEqual([
        { type: 'lucene', condition: 'ServiceName:"checkout"' },
        { type: 'sql', condition: "Env = 'prod'" },
      ]);
    });

    // Lucene bare terms need the source's implicit column to render.
    it('carries the implicit column expression for Lucene filters', () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
      );

      expect(config.implicitColumnExpression).toBe('Body');
    });
  });
});

describe('releaseRowsToAnnotations', () => {
  const windowStart = new Date('2026-07-01T00:00:00.000Z');
  const inside = '2026-07-01T00:30:00.000Z';

  it('maps a version first seen inside the window to a marker', () => {
    const [annotation] = releaseRowsToAnnotations(
      [{ firstSeen: inside, version: '1.43.1', service: 'checkout' }],
      { windowStart },
    );

    expect(annotation).toMatchObject({
      time: new Date(inside).getTime(),
      label: '1.43.1',
      color: getChartColorInfo(),
      kind: 'release',
      groupNoun: 'releases',
    });
  });

  // The query range is widened backwards so the version that was already
  // running shows up; it must not be drawn as a deploy at the left edge.
  it('drops the version that was already running when the window opened', () => {
    const annotations = releaseRowsToAnnotations(
      [
        { firstSeen: '2026-06-30T23:00:00.000Z', version: '1.43.0' },
        { firstSeen: inside, version: '1.43.1' },
      ],
      { windowStart },
    );

    expect(annotations.map(a => a.label)).toEqual(['1.43.1']);
  });

  it('keeps a version first seen exactly at the window start', () => {
    const annotations = releaseRowsToAnnotations(
      [{ firstSeen: windowStart.toISOString(), version: '1.43.1' }],
      { windowStart },
    );

    expect(annotations).toHaveLength(1);
  });

  it('drops rows with a missing or unparseable timestamp or version', () => {
    const annotations = releaseRowsToAnnotations(
      [
        { firstSeen: null, version: '1.0.0' },
        { firstSeen: 'not a date', version: '1.0.0' },
        { firstSeen: inside, version: '' },
        { firstSeen: inside, version: null },
        { firstSeen: inside, version: '1.43.1' },
      ],
      { windowStart },
    );

    expect(annotations.map(a => a.label)).toEqual(['1.43.1']);
  });

  it('gives each marker a distinct key so React can reconcile them', () => {
    const annotations = releaseRowsToAnnotations(
      [
        { firstSeen: inside, version: '1.43.1', service: 'checkout' },
        { firstSeen: inside, version: '1.43.1', service: 'payments' },
      ],
      { windowStart },
    );

    expect(annotations[0].key).not.toEqual(annotations[1].key);
  });
});

describe('useReleaseAnnotations', () => {
  const range: [Date, Date] = [
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-01T01:00:00.000Z'),
  ];

  const mockQuery = (rows: unknown[] | undefined, isFetching = false) =>
    mockedUseQueriedChartConfig.mockReturnValue({
      data: rows ? { data: rows } : undefined,
      isFetching,
    });

  /** The config and options the hook last handed to `useQueriedChartConfig`. */
  const lastCall = (): [
    BuilderChartConfigWithDateRange,
    { enabled: boolean },
  ] =>
    mockedUseQueriedChartConfig.mock.calls[
      mockedUseQueriedChartConfig.mock.calls.length - 1
    ];

  beforeEach(() => mockQuery([]));
  afterEach(() => jest.clearAllMocks());

  it('returns undefined and keeps the query idle when disabled', () => {
    mockQuery([{ firstSeen: '2026-07-01T00:30:00.000Z', version: '1.0.0' }]);

    const { result } = renderHook(() =>
      useReleaseAnnotations(range, false, { source: logSource }),
    );

    expect(result.current).toBeUndefined();
    expect(lastCall()[1]).toMatchObject({ enabled: false });
  });

  it('keeps the query idle when the tile has no source', () => {
    renderHook(() => useReleaseAnnotations(range, true));

    expect(lastCall()[1]).toMatchObject({ enabled: false });
  });

  it('keeps the query idle for a source that cannot provide releases', () => {
    renderHook(() =>
      useReleaseAnnotations(range, true, { source: metricSource }),
    );

    expect(lastCall()[1]).toMatchObject({ enabled: false });
  });

  it('returns markers for versions first seen inside the window', () => {
    mockQuery([
      { firstSeen: '2026-07-01T00:30:00.000Z', version: '1.43.1' },
      { firstSeen: '2026-06-30T20:00:00.000Z', version: '1.43.0' },
    ]);

    const { result } = renderHook(() =>
      useReleaseAnnotations(range, true, { source: logSource }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current?.[0]).toMatchObject({
      label: '1.43.1',
      kind: 'release',
    });
  });

  it('returns undefined rather than an empty array when nothing is found', () => {
    mockQuery([{ firstSeen: '2026-06-30T20:00:00.000Z', version: '1.43.0' }]);

    const { result } = renderHook(() =>
      useReleaseAnnotations(range, true, { source: logSource }),
    );

    expect(result.current).toBeUndefined();
  });

  it("uses the source's configured version expression", () => {
    renderHook(() =>
      useReleaseAnnotations(range, true, {
        source: {
          ...logSource,
          serviceVersionExpression: "ResourceAttributes['container.image.tag']",
        },
      }),
    );

    expect(lastCall()[0].select).toContain(
      "ResourceAttributes['container.image.tag'] AS version",
    );
  });

  it("scopes the query with the tile's filters", () => {
    renderHook(() =>
      useReleaseAnnotations(range, true, {
        source: logSource,
        where: 'ServiceName:"checkout"',
        whereLanguage: 'lucene',
      }),
    );

    expect(lastCall()[0].filters).toEqual([
      { type: 'lucene', condition: 'ServiceName:"checkout"' },
    ]);
  });

  it('widens the query range backwards to spot the already-running version', () => {
    renderHook(() => useReleaseAnnotations(range, true, { source: logSource }));

    const [queryStart, queryEnd] = lastCall()[0].dateRange;

    // 10% of a one-hour window is under the 30 minute floor, so the floor wins.
    expect(range[0].getTime() - queryStart.getTime()).toBe(30 * 60_000);
    expect(queryEnd.getTime()).toBe(range[1].getTime());
  });

  // A live window ending mid-minute; both bounds quantize to the same bucket
  // as it slides forward a few seconds.
  const liveRange: [Date, Date] = [
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-01T01:00:30.000Z'),
  ];
  const slid = (ms: number): [Date, Date] => [
    liveRange[0],
    new Date(liveRange[1].getTime() + ms),
  ];

  // Callers rebuild the filters array every render. If that churned the config,
  // react-query would issue one request per tile instead of sharing one.
  it('reuses one config object as a live window slides within the minute', () => {
    const { rerender } = renderHook(
      ({ dateRange }) =>
        useReleaseAnnotations(dateRange, true, {
          source: logSource,
          filters: [{ type: 'sql', condition: "Env = 'prod'" }],
        }),
      { initialProps: { dateRange: liveRange } },
    );
    const first = mockedUseQueriedChartConfig.mock.calls[0][0];

    rerender({ dateRange: slid(5_000) });

    expect(lastCall()[0]).toBe(first);
  });

  it('rebuilds the config once the window crosses a minute boundary', () => {
    const { rerender } = renderHook(
      ({ dateRange }) =>
        useReleaseAnnotations(dateRange, true, { source: logSource }),
      { initialProps: { dateRange: liveRange } },
    );
    const first = mockedUseQueriedChartConfig.mock.calls[0][0];

    rerender({ dateRange: slid(120_000) });

    expect(lastCall()[0]).not.toBe(first);
  });
});
