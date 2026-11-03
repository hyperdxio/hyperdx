import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  errorStatusPredicateSql,
  serverSpanKindPredicateSql,
} from '@hyperdx/common-utils/dist/core/spanPredicates';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
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

export const SERVICE_ALIAS = '__hdx_service';

/**
 * Plain copies of the trace source fields the queries read. The Mongoose
 * document's subdocuments (e.g. `from`) don't belong in a chart config, which
 * the renderer may clone.
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
};

export type QueryContext = {
  client: ClickhouseClient;
  metadata: Metadata;
  source: HealthSource;
  input: ServiceHealthInput;
  signal: AbortSignal;
};

/** A result row's columns by alias. Build once per row, then read with get. */
export const columns = (row: Record<string, unknown>) =>
  new Map(Object.entries(row));

export const sqlList = (values: string[]) =>
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

export async function run(
  ctx: QueryContext,
  config: BuilderChartConfigWithDateRange,
): Promise<{ rows: Record<string, string | number>[] }> {
  const { client, metadata, source, signal } = ctx;
  // No materialized-view rewrite: it rounds the window to the view's
  // granularity, which would break the half-open windows the comparison
  // relies on, and the error-group queries can't use a view anyway.
  const result = await client.queryChartConfig({
    config,
    metadata,
    querySettings: source.querySettings,
    opts: {
      clickhouse_settings: mcpQuerySettings(source.querySettings),
      abort_signal: signal,
    },
  });
  return { rows: result.data ?? [] };
}

export const toNumberOrNull = (v: unknown) => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};

/** Requests, errors, and latency quantiles per service in one window. */
export async function fetchServiceStats(
  ctx: QueryContext,
  window: Window,
): Promise<{ stats: Map<string, WindowStats> }> {
  const { source } = ctx;
  const quantile = (level: number, alias: string) => ({
    aggFn: 'quantile' as const,
    level,
    valueExpression: source.durationExpression,
    aggCondition: '',
    aggConditionLanguage: 'sql' as const,
    alias,
  });
  const { rows } = await run(ctx, {
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
    stats.set(String(columns(row).get(SERVICE_ALIAS) ?? ''), {
      requests: Number(row.requests) || 0,
      errors: Number(row.errors) || 0,
      p50Ms: toMs(row.p50),
      p95Ms: toMs(row.p95),
      p99Ms: toMs(row.p99),
    });
  }
  return { stats };
}
