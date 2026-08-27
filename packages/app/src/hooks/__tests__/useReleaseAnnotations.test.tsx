import { isValidElement } from 'react';
import {
  BuilderChartConfigWithDateRange,
  DerivedColumn,
  SearchConditionLanguage,
  SourceKind,
  TLogSource,
  TMetricSource,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  aggConditionScopeFilter,
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
// A getter (rather than a plain value) so individual tests can flip
// `mockIsLocalMode` without re-mocking the module.
let mockIsLocalMode = false;
jest.mock('@/config', () => ({
  __esModule: true,
  get IS_LOCAL_MODE() {
    return mockIsLocalMode;
  },
}));

// Untyped handle on the mocked hook. Going through the module object keeps the
// mock's argument and return types loose, so the fixtures below don't need
// wide casts to stand in for a full react-query result.
const chartConfigModule: { useQueriedChartConfig: jest.Mock } =
  jest.requireMock('@/hooks/useChartConfig');
const mockedUseQueriedChartConfig = chartConfigModule.useQueriedChartConfig;

const notificationsModule: { notifications: { show: jest.Mock } } =
  jest.requireMock('@mantine/notifications');
const mockedNotificationsShow = notificationsModule.notifications.show;

/**
 * The error notification's `message` is JSX (to carry a truncated raw error
 * and, for missing-column errors, a settings link), not a plain string.
 * Walks it to recover the rendered text and any `href`s for assertions.
 * Takes `unknown` (rather than `ReactNode`) so narrowing an element's untyped
 * `props` needs only `in` checks, not a type assertion.
 */
function readNotificationMessage(node: unknown): {
  text: string;
  hrefs: string[];
} {
  if (node == null || typeof node === 'boolean') {
    return { text: '', hrefs: [] };
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return { text: String(node), hrefs: [] };
  }
  if (Array.isArray(node)) {
    return node.reduce<{ text: string; hrefs: string[] }>(
      (acc, child) => {
        const next = readNotificationMessage(child);
        return {
          text: acc.text + next.text,
          hrefs: [...acc.hrefs, ...next.hrefs],
        };
      },
      { text: '', hrefs: [] },
    );
  }
  if (isValidElement(node)) {
    const props: unknown = node.props;
    if (props == null || typeof props !== 'object') {
      return { text: '', hrefs: [] };
    }
    const children = 'children' in props ? props.children : undefined;
    const href =
      'href' in props && typeof props.href === 'string'
        ? props.href
        : undefined;
    const inner = readNotificationMessage(children);
    return {
      text: inner.text,
      hrefs: href ? [...inner.hrefs, href] : inner.hrefs,
    };
  }
  return { text: '', hrefs: [] };
}

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

    it("carries the tile's folded series condition", () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
        {
          seriesCondition: { type: 'lucene', condition: 'ServiceName:"cart"' },
        },
      );

      expect(config.filters).toEqual([
        { type: 'lucene', condition: 'ServiceName:"cart"' },
      ]);
    });

    // The tile ANDs its own where with its series conditions and the dashboard
    // filters, so the releases query has to as well.
    it('ANDs the where clause, the series condition and the dashboard filters', () => {
      const config = buildReleaseChartConfig(
        logSource,
        DEFAULT_VERSION_EXPRESSION,
        range,
        {
          where: 'Env:"prod"',
          whereLanguage: 'lucene',
          seriesCondition: { type: 'lucene', condition: 'ServiceName:"cart"' },
          filters: [{ type: 'sql', condition: "Region = 'us-east-1'" }],
        },
      );

      expect(config.filters).toEqual([
        { type: 'lucene', condition: 'Env:"prod"' },
        { type: 'lucene', condition: 'ServiceName:"cart"' },
        { type: 'sql', condition: "Region = 'us-east-1'" },
      ]);
      expect(config.filtersLogicalOperator).toBeUndefined();
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

describe('aggConditionScopeFilter', () => {
  /** A series carrying just the fields the fold reads. */
  const series = (
    aggCondition: string,
    aggConditionLanguage?: SearchConditionLanguage,
  ): DerivedColumn => ({
    aggFn: 'count',
    valueExpression: '',
    aggCondition,
    aggConditionLanguage,
  });

  it("folds a single series' condition into a filter", () => {
    expect(
      aggConditionScopeFilter([series('ServiceName:"cart"', 'lucene')]),
    ).toEqual({ type: 'lucene', condition: 'ServiceName:"cart"' });
  });

  it('keeps a SQL series condition in SQL', () => {
    expect(
      aggConditionScopeFilter([series("ServiceName = 'cart'", 'sql')]),
    ).toEqual({ type: 'sql', condition: "ServiceName = 'cart'" });
  });

  // Matches how the per-series aggregate renders an unset language.
  it('treats an unset language as Lucene', () => {
    expect(aggConditionScopeFilter([series('ServiceName:"cart"')])).toEqual({
      type: 'lucene',
      condition: 'ServiceName:"cart"',
    });
  });

  // renderChartConfig ORs the series conditions into the scan predicate, so the
  // union is the set of rows the tile reads.
  it('ORs several series conditions together', () => {
    expect(
      aggConditionScopeFilter([
        series('SeverityText:"error"', 'lucene'),
        series('SeverityText:"warn"', 'lucene'),
      ]),
    ).toEqual({
      type: 'lucene',
      condition: '(SeverityText:"error") OR (SeverityText:"warn")',
    });
  });

  // The common multi-series tile: several aggregates over one filter, as in the
  // shipped browser-rum template. Collapse rather than OR the filter with itself.
  it('collapses series that share one condition', () => {
    expect(
      aggConditionScopeFilter([
        series('SpanName:"documentLoad"', 'lucene'),
        series('SpanName:"documentLoad"', 'lucene'),
        series('SpanName:"documentLoad"', 'lucene'),
      ]),
    ).toEqual({ type: 'lucene', condition: 'SpanName:"documentLoad"' });
  });

  // With one series unfiltered the tile scans every row, so there is nothing to
  // narrow the releases query by.
  it('yields nothing when any series is unfiltered', () => {
    expect(
      aggConditionScopeFilter([
        series('SeverityText:"error"', 'lucene'),
        series('  ', 'lucene'),
      ]),
    ).toBeUndefined();
    expect(aggConditionScopeFilter([series('', 'lucene')])).toBeUndefined();
  });

  // Conditions in different languages can't be combined into one predicate;
  // going unscoped beats scoping wrongly.
  it('yields nothing for series in mixed languages', () => {
    expect(
      aggConditionScopeFilter([
        series('SeverityText:"error"', 'lucene'),
        series("SeverityText = 'warn'", 'sql'),
      ]),
    ).toBeUndefined();
  });

  // `Filter` only speaks SQL and Lucene.
  it('yields nothing for a PromQL series condition', () => {
    expect(aggConditionScopeFilter([series('up', 'promql')])).toBeUndefined();
  });

  it('yields nothing for a raw select string or an empty series list', () => {
    expect(aggConditionScopeFilter('count() AS value')).toBeUndefined();
    expect(aggConditionScopeFilter([])).toBeUndefined();
    expect(aggConditionScopeFilter(undefined)).toBeUndefined();
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
      isError: false,
      error: null,
    });

  const mockQueryError = (error: Error) =>
    mockedUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isFetching: false,
      isError: true,
      error,
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
  afterEach(() => {
    jest.clearAllMocks();
    mockIsLocalMode = false;
  });

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

  // Regression: the `isError` branch was added ahead of this one; guard
  // against a future reorder silently swallowing the empty-result case.
  it('warns "no releases found" for a genuinely empty result', () => {
    mockQuery([{ firstSeen: '2026-06-30T20:00:00.000Z', version: '1.43.0' }]);

    renderHook(() => useReleaseAnnotations(range, true, { source: logSource }));

    expect(mockedNotificationsShow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'release-markers-empty' }),
    );
    expect(mockedNotificationsShow).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'release-markers-error' }),
    );
  });

  // Regression: unlike a structural error, "no releases found" is inherently
  // per-window -- a different range can genuinely have different releases --
  // so an unchanged scope must not suppress a second window's empty warning.
  it('warns again for a new window even if a previous window already warned empty', () => {
    // A timestamp before any window in this test, so every window maps to
    // the same "genuinely empty" result regardless of its bounds.
    mockQuery([{ firstSeen: '2000-01-01T00:00:00.000Z', version: '1.0.0' }]);

    const { rerender } = renderHook(
      ({ range }: { range: [Date, Date] }) =>
        useReleaseAnnotations(range, true, { source: logSource }),
      { initialProps: { range } },
    );
    expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);
    expect(mockedNotificationsShow).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'release-markers-empty' }),
    );

    rerender({
      range: [
        new Date(range[0].getTime() + 24 * 60 * 60_000),
        new Date(range[1].getTime() + 24 * 60 * 60_000),
      ],
    });

    expect(mockedNotificationsShow).toHaveBeenCalledTimes(2);
    expect(mockedNotificationsShow).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'release-markers-empty' }),
    );
  });

  describe('query errors', () => {
    // A query failure and a truly-empty result both leave `data` unset;
    // without distinguishing `isError` the two look identical to the user.
    it('warns distinctly on a query error rather than reporting "no releases found"', () => {
      mockQueryError(new Error('Timeout exceeded'));

      const { result } = renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );

      expect(result.current).toBeUndefined();
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);
      const call = mockedNotificationsShow.mock.calls[0][0];
      expect(call).toMatchObject({ id: 'release-markers-error', color: 'red' });
      expect(readNotificationMessage(call.message).text).toContain(
        'Timeout exceeded',
      );
    });

    // The scenario in question: a source configured for release markers
    // whose table has no matching column (e.g. no `ResourceAttributes`).
    it('gives an actionable hint for a missing-column error, linking to the source settings', () => {
      mockQueryError(new Error("Missing columns: 'ResourceAttributes'"));

      renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );

      const call = mockedNotificationsShow.mock.calls[0][0];
      expect(call.id).toBe('release-markers-error');
      const { text, hrefs } = readNotificationMessage(call.message);
      expect(text).toContain('Service Version Expression');
      expect(text).toContain("Missing columns: 'ResourceAttributes'");
      expect(hrefs).toContain(`/team#source-${logSource.id}`);
    });

    // Regression: `/team` isn't reachable in local mode (e.g. the Vercel
    // preview), so linking there would be a dead link.
    it('omits the Team Settings link in local mode', () => {
      mockIsLocalMode = true;
      mockQueryError(new Error("Missing columns: 'ResourceAttributes'"));

      renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );

      const call = mockedNotificationsShow.mock.calls[0][0];
      const { text, hrefs } = readNotificationMessage(call.message);
      expect(text).toContain("doesn't match a column on this source");
      expect(hrefs).toEqual([]);
    });

    // Real ClickHouse errors often echo the full rendered SQL, which is
    // unreadable dumped whole into a toast.
    it('truncates a long raw error message', () => {
      mockQueryError(new Error('x'.repeat(500)));

      renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );

      const call = mockedNotificationsShow.mock.calls[0][0];
      const { text } = readNotificationMessage(call.message);
      expect(text.length).toBeLessThan(500);
      expect(text).toContain('…');
    });

    it('warns only once while the error persists', () => {
      mockQueryError(new Error('Timeout exceeded'));

      const { rerender } = renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );
      rerender();

      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);
    });

    // Regression: the warned-once latch used to reset only when markers were
    // toggled off, so a later, differently-scoped query's own error (or empty
    // result) silently went unreported because the earlier query had already
    // tripped the latch.
    it('warns again for a new query even if a previous query already warned', () => {
      mockQueryError(new Error('Timeout exceeded'));

      const { rerender } = renderHook(
        ({ where }: { where: string }) =>
          useReleaseAnnotations(range, true, { source: logSource, where }),
        { initialProps: { where: 'ServiceName:"checkout"' } },
      );
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);

      mockQueryError(new Error('Connection reset'));
      rerender({ where: 'ServiceName:"cart"' });

      expect(mockedNotificationsShow).toHaveBeenCalledTimes(2);
      const lastCallArg =
        mockedNotificationsShow.mock.calls[
          mockedNotificationsShow.mock.calls.length - 1
        ][0];
      expect(lastCallArg.id).toBe('release-markers-error');
      expect(readNotificationMessage(lastCallArg.message).text).toContain(
        'Connection reset',
      );
    });

    // A reviewer's point: panning/zooming the time range doesn't fix a
    // structural error (e.g. a missing column), so re-showing the same
    // warning on every range change -- which happens every `BUCKET_MS` on a
    // live-tailing dashboard -- would just be noise.
    it('does not warn again for a pure time-range change on the same scope', () => {
      mockQueryError(new Error('Timeout exceeded'));

      const { rerender } = renderHook(
        ({ range }: { range: [Date, Date] }) =>
          useReleaseAnnotations(range, true, { source: logSource }),
        { initialProps: { range } },
      );
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);

      rerender({
        range: [
          new Date(range[0].getTime() + 5 * 60_000),
          new Date(range[1].getTime() + 5 * 60_000),
        ],
      });

      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);
    });

    // Regression: a single boolean latch stayed tripped across a kind
    // change on the *same* query (e.g. a background refetch that flips an
    // empty result to an error), silently swallowing the second warning.
    it('warns again when the result kind changes without a config change', () => {
      mockQueryError(new Error('Timeout exceeded'));

      const { rerender } = renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);

      mockQuery([{ firstSeen: '2026-06-30T20:00:00.000Z', version: '1.43.0' }]);
      rerender();
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(2);
      expect(mockedNotificationsShow).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'release-markers-empty' }),
      );

      mockQueryError(new Error('Timeout exceeded'));
      rerender();
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(3);
      expect(mockedNotificationsShow).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'release-markers-error' }),
      );
    });

    // A real (non-empty) result between two failures clears the latch, same
    // as a distinct kind would -- a later failure is never "the same" one.
    it('warns again after recovering and failing once more on the same config', () => {
      mockQueryError(new Error('Timeout exceeded'));

      const { rerender } = renderHook(() =>
        useReleaseAnnotations(range, true, { source: logSource }),
      );
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);

      mockQuery([{ firstSeen: '2026-07-01T00:30:00.000Z', version: '1.43.1' }]);
      rerender();
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(1);

      mockQueryError(new Error('Timeout exceeded'));
      rerender();
      expect(mockedNotificationsShow).toHaveBeenCalledTimes(2);
    });
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

  // Regression: a time chart's filter lives in each series' `aggCondition`, not
  // in the statement-level `where`, so reading only `where` left every time
  // chart's markers unscoped.
  it("scopes the query with the tile's per-series conditions", () => {
    renderHook(() =>
      useReleaseAnnotations(range, true, {
        source: logSource,
        where: '',
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: 'ServiceName:"checkout"',
            aggConditionLanguage: 'lucene',
          },
        ],
      }),
    );

    expect(lastCall()[0].filters).toEqual([
      { type: 'lucene', condition: 'ServiceName:"checkout"' },
    ]);
  });

  // Only the folded condition keys the memo, so restyling a series must not
  // rebuild the config and refire the query.
  it('reuses one config object when a cosmetic series field changes', () => {
    type SeriesColor = DerivedColumn['color'];
    const select = (color: SeriesColor): DerivedColumn[] => [
      {
        aggFn: 'count',
        valueExpression: '',
        aggCondition: 'ServiceName:"checkout"',
        aggConditionLanguage: 'lucene',
        color,
      },
    ];

    const { result, rerender } = renderHook(
      ({ color }: { color: SeriesColor }) =>
        useReleaseAnnotations(range, true, {
          source: logSource,
          select: select(color),
        }),
      { initialProps: { color: 'chart-blue' as SeriesColor } },
    );
    const first = lastCall()[0];
    rerender({ color: 'chart-red' });

    expect(lastCall()[0]).toBe(first);
    expect(result.current).toBeUndefined();
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
