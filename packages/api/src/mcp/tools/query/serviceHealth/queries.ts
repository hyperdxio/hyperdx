import { tryOptimizeConfigWithMaterializedView } from '@hyperdx/common-utils/dist/core/materializedViews';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  errorStatusPredicateSql,
  serverSpanKindPredicateSql,
} from '@hyperdx/common-utils/dist/core/spanPredicates';
import {
  escapeSqlString,
  getFirstTimestampValueExpression,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  type BuilderChartConfigWithDateRange,
  DisplayType,
  type Filter,
  pickSampleWeightExpressionProps,
  type QuerySettings,
  SourceKind,
  type TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import type { ClickhouseClient } from '@/clickhouse';
import { durationDivisor, mcpQuerySettings } from '@/mcp/tools/trace/shared';

import type { WindowStats } from './rank';
import type { ServiceHealthInput, Window } from './schema';

const SERVICE_ALIAS = '__hdx_service';
const ERROR_COUNT_ALIAS = '__hdx_error_count';
const FIRST_SEEN_ALIAS = '__hdx_first_seen';
const LAST_SEEN_ALIAS = '__hdx_last_seen';
const errorKeyAlias = (i: number) => `__hdx_error_key_${i}`;

/** Upper bound on error-group rows fetched, before bucketing per service. */
const MAX_ERROR_ROWS = 2500;

type MvSource = Parameters<typeof tryOptimizeConfigWithMaterializedView>[4];

/**
 * Plain copies of the trace source fields the queries read. The Mongoose
 * document's subdocuments (e.g. `from`) can't go into a chart config, because
 * the MV optimizer structuredClones the config.
 */
export type HealthSource = Pick<
  TTraceSource,
  | 'id'
  | 'timestampValueExpression'
  | 'implicitColumnExpression'
  | 'useTextIndexForImplicitColumn'
  | 'sampleRateExpression'
  | 'spanNameExpression'
  | 'spanKindExpression'
  | 'statusMessageExpression'
  | 'durationExpression'
  | 'durationPrecision'
  | 'metricSourceId'
> & {
  connection: string;
  from: { databaseName: string; tableName: string };
  serviceNameExpression: string;
  statusCodeExpression: string;
  querySettings: QuerySettings | undefined;
  /** The original document, for the MV optimizer. Unset when it has no MVs. */
  mvSource: MvSource | undefined;
};

export type QueryContext = {
  client: ClickhouseClient;
  metadata: Metadata;
  source: HealthSource;
  input: ServiceHealthInput;
  signal: AbortSignal;
};

export type ErrorGroup = {
  service: string;
  group: Record<string, string>;
  count: number;
  /** Epoch ms of the first and last error in the window, if known. */
  firstSeenMs?: number;
  lastSeenMs?: number;
};

const sqlList = (values: string[]) =>
  values.map(v => `'${escapeSqlString(v)}'`).join(', ');

export function baseConfig(
  { source, input }: QueryContext,
  window: Window,
  extraFilters: Filter[],
): Omit<BuilderChartConfigWithDateRange, 'select'> {
  const filters: Filter[] = [...extraFilters];
  if (input.spanKind === 'server') {
    filters.push({
      type: 'sql',
      condition: serverSpanKindPredicateSql(source.spanKindExpression),
    });
  }
  if (input.services?.length) {
    filters.push({
      type: 'sql',
      condition: `${source.serviceNameExpression} IN (${sqlList(input.services)})`,
    });
  }
  return {
    displayType: DisplayType.Table,
    source: source.id,
    connection: source.connection,
    from: source.from,
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: source.implicitColumnExpression,
    useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
    ...pickSampleWeightExpressionProps({
      kind: SourceKind.Trace,
      sampleRateExpression: source.sampleRateExpression,
    }),
    where: input.where,
    whereLanguage: input.where ? input.whereLanguage : 'sql',
    filters,
    dateRange: [window.start, window.end],
    // Half-open windows: with an inclusive end, a span at exactly the
    // boundary lands in both the comparison and the current window.
    dateRangeEndInclusive: false,
  };
}

async function run(
  ctx: QueryContext,
  config: BuilderChartConfigWithDateRange,
): Promise<{ rows: Record<string, string | number>[]; mvUsed: boolean }> {
  const { client, metadata, source, signal } = ctx;
  const optimized = source.mvSource
    ? await tryOptimizeConfigWithMaterializedView(
        config,
        metadata,
        client,
        signal,
        source.mvSource,
      )
    : config;
  const result = await client.queryChartConfig({
    config: optimized,
    metadata,
    querySettings: source.querySettings,
    opts: {
      clickhouse_settings: mcpQuerySettings(source.querySettings),
      abort_signal: signal,
    },
  });
  return { rows: result.data ?? [], mvUsed: optimized !== config };
}

const toNumberOrNull = (v: unknown) => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};

/** Requests, errors, and latency quantiles per service in one window. */
export async function fetchServiceStats(
  ctx: QueryContext,
  window: Window,
): Promise<{ stats: Map<string, WindowStats>; mvUsed: boolean }> {
  const { source } = ctx;
  const quantile = (level: number, alias: string) => ({
    aggFn: 'quantile' as const,
    level,
    valueExpression: source.durationExpression,
    aggCondition: '',
    aggConditionLanguage: 'sql' as const,
    alias,
  });
  const { rows, mvUsed } = await run(ctx, {
    ...baseConfig(ctx, window, []),
    select: [
      { aggFn: 'count', valueExpression: '', alias: 'requests' },
      {
        aggFn: 'count',
        valueExpression: '',
        aggCondition: errorStatusPredicateSql(source.statusCodeExpression),
        aggConditionLanguage: 'sql',
        alias: 'errors',
      },
      quantile(0.5, 'p50'),
      quantile(0.95, 'p95'),
      quantile(0.99, 'p99'),
    ],
    groupBy: [
      { valueExpression: source.serviceNameExpression, alias: SERVICE_ALIAS },
    ],
  });

  const divisor = durationDivisor(source.durationPrecision);
  const toMs = (v: unknown) => {
    const n = toNumberOrNull(v);
    return n == null ? null : Math.round((n / divisor) * 100) / 100;
  };
  const stats = new Map<string, WindowStats>();
  for (const row of rows) {
    stats.set(String(row[SERVICE_ALIAS] ?? ''), {
      requests: Number(row.requests) || 0,
      errors: Number(row.errors) || 0,
      p50Ms: toMs(row.p50),
      p95Ms: toMs(row.p95),
      p99Ms: toMs(row.p99),
    });
  }
  return { stats, mvUsed };
}

/** The expressions that define an error group, in output order. */
export function errorGroupExpressions(
  source: HealthSource,
  errorGroupBy: string | undefined,
  split: (s: string) => string[],
): string[] {
  const exprs = errorGroupBy
    ? split(errorGroupBy)
    : [source.spanNameExpression, source.statusMessageExpression];
  return exprs.filter(
    (e): e is string => !!e && e !== source.serviceNameExpression,
  );
}

/**
 * Error counts per (service, group) in one window. `match` restricts rows to
 * exact (service, ...group) tuples, so the comparison window is looked up for
 * the groups found in the current window instead of its own top-N.
 */
export async function fetchErrorGroups(
  ctx: QueryContext,
  window: Window,
  groupExprs: string[],
  scope: { services: string[] } | { match: ErrorGroup[] },
): Promise<ErrorGroup[]> {
  const { source } = ctx;
  const keyExprs = [source.serviceNameExpression, ...groupExprs];
  const epochMs = `toUnixTimestamp64Milli(toDateTime64(${getFirstTimestampValueExpression(source.timestampValueExpression)}, 3))`;
  const scopeCondition =
    'services' in scope
      ? `${source.serviceNameExpression} IN (${sqlList(scope.services)})`
      : `tuple(${keyExprs.map(e => `toString(${e})`).join(', ')}) IN (${scope.match
          .map(
            g =>
              `tuple(${sqlList([g.service, ...groupExprs.map(e => g.group[e] ?? '')])})`,
          )
          .join(', ')})`;

  const { rows } = await run(ctx, {
    ...baseConfig(ctx, window, [
      {
        type: 'sql',
        condition: errorStatusPredicateSql(source.statusCodeExpression),
      },
      { type: 'sql', condition: scopeCondition },
    ]),
    select: [
      { aggFn: 'count', valueExpression: '', alias: ERROR_COUNT_ALIAS },
      // Epoch ms, because min/max cast their argument to Float64.
      { aggFn: 'min', valueExpression: epochMs, alias: FIRST_SEEN_ALIAS },
      { aggFn: 'max', valueExpression: epochMs, alias: LAST_SEEN_ALIAS },
    ],
    groupBy: [
      { valueExpression: source.serviceNameExpression, alias: SERVICE_ALIAS },
      ...groupExprs.map((e, i) => ({
        valueExpression: `toString(${e})`,
        alias: errorKeyAlias(i),
      })),
    ],
    orderBy: `${ERROR_COUNT_ALIAS} DESC`,
    limit: { limit: MAX_ERROR_ROWS },
  });

  return rows.map(row => ({
    service: String(row[SERVICE_ALIAS] ?? ''),
    group: Object.fromEntries(
      groupExprs.map((e, i) => [e, String(row[errorKeyAlias(i)] ?? '')]),
    ),
    count: Number(row[ERROR_COUNT_ALIAS]) || 0,
    firstSeenMs: toNumberOrNull(row[FIRST_SEEN_ALIAS]) || undefined,
    lastSeenMs: toNumberOrNull(row[LAST_SEEN_ALIAS]) || undefined,
  }));
}

export const errorGroupKey = (g: Pick<ErrorGroup, 'service' | 'group'>) =>
  JSON.stringify([g.service, ...Object.values(g.group)]);
