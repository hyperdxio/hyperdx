import {
  chSql,
  concatChSql,
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import {
  QUERYABLE_METRIC_KINDS,
  type QueryableMetricKind,
} from './metricKinds';

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DESCRIBE_TIMEOUT_MS = 10_000;

// Server-side safety nets for the attribute-keys discovery query.
// Sample at most N rows that match (MetricName, time range), then
// aggregate from that sample. ClickHouse can stop scanning once the
// CTE has N matching rows so a hot metric does not starve the
// wall-clock budget. 100k rows is plenty to surface every unique map
// key on a healthy OTel metric.
const METRIC_ATTR_KEYS_SAMPLE_SIZE = 100_000;
const METRIC_ATTR_KEYS_MAX_EXEC_SECONDS = 8;

// Max sampled values per attribute key (when sampleValues is true).
const MAX_ATTR_VALUES = 10;
// Cap on the number of attribute keys we sample values for per kind to
// avoid runaway fan-out on high-cardinality metrics.
const MAX_ATTR_KEYS_TO_SAMPLE = 12;

// Per-kind aggregation guidance baked into the response so the agent can
// build a valid clickstack_timeseries / clickstack_table call without
// re-reading the schemas.
const KIND_USAGE: Record<QueryableMetricKind, string> = {
  gauge:
    'Gauge: use aggFn:"last_value"|"avg"|"min"|"max" on Value. Set isDelta:true for Prometheus-style delta over each bucket.',
  sum: 'Sum (counter): use aggFn:"increase" for the per-bucket counter increase (reset-aware), or aggFn:"sum"/"avg" on the computed rate. increase+groupBy is capped at the top 20 groups.',
  histogram:
    'Histogram: use aggFn:"quantile" with level ∈ {0.5, 0.9, 0.95, 0.99} for percentiles, or aggFn:"count" for the total bucket count.',
};

// ─── Schema ──────────────────────────────────────────────────────────────────

const describeMetricSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Source ID. Must reference a metric source — get IDs from clickstack_list_sources.',
    ),
  metricName: z
    .string()
    .min(1)
    .describe(
      'OTel metric name to describe (e.g. "system.cpu.utilization", "http.server.request.duration"). ' +
        'Discover via clickstack_list_metrics or clickstack_describe_source.',
    ),
  kind: z
    .enum(QUERYABLE_METRIC_KINDS)
    .describe(
      'Metric kind: "gauge" | "sum" | "histogram". Required. ' +
        'Discover via clickstack_list_metrics (which returns name + kind per entry) ' +
        'or clickstack_describe_source (which groups metric-name samples by kind). ' +
        'A metric name can legitimately live in more than one kind (e.g. ' +
        '"container.cpu.usage" appears in both gauge and sum) — pick the kind ' +
        'matching the value you want to query.',
    ),
  startTime: z
    .string()
    .optional()
    .describe(
      'Restrict discovery to data points after this ISO 8601 timestamp. Default: 24 hours before endTime (or now).',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the discovery window as ISO 8601. Default: now.'),
  sampleValues: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true (default), sample up to ' +
        `${MAX_ATTR_VALUES} distinct values per attribute key for the top ${MAX_ATTR_KEYS_TO_SAMPLE} attributes. ` +
        'Set false to skip value sampling for faster responses on high-cardinality metrics.',
    ),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

type KindDetail = {
  kind: QueryableMetricKind;
  tableName: string;
  unit?: string;
  description?: string;
  attributeKeys: Record<string, string[]>;
  attributeValues?: Record<string, string[]>;
  usage: string;
};

/**
 * Discriminated result for the discovery sub-queries so the caller can
 * distinguish "fetch failed" from "genuinely empty" — the two cases
 * need different agent guidance (retry/report vs. widen the window).
 */
type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Compact an error for inclusion in a tool response: single line,
 * capped length, no stack frames.
 */
function sanitizeFetchError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function parseTimeRange(
  startTime?: string,
  endTime?: string,
): { error: string } | { startDate: Date; endDate: Date } {
  const endDate = endTime ? new Date(endTime) : new Date();
  const startDate = startTime
    ? new Date(startTime)
    : new Date(endDate.getTime() - DEFAULT_LOOKBACK_MS);
  if (isNaN(endDate.getTime()) || isNaN(startDate.getTime())) {
    return {
      error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',
    };
  }
  if (startDate >= endDate) {
    return { error: 'endTime must be greater than startTime' };
  }
  return { startDate, endDate };
}

/**
 * Fetch unit and description for a metric name on a single kind table.
 * Returns undefined values when the columns are absent from the schema.
 */
async function fetchUnitAndDescription({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  metricName,
  startDate,
  endDate,
  hasUnit,
  hasDescription,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  metricName: string;
  startDate: Date;
  endDate: Date;
  hasUnit: boolean;
  hasDescription: boolean;
  signal: AbortSignal;
}): Promise<{ unit?: string; description?: string }> {
  if (!hasUnit && !hasDescription) return {};
  const projections = [
    ...(hasUnit
      ? [chSql`anyLast(${{ Identifier: 'MetricUnit' }}) AS MetricUnit`]
      : []),
    ...(hasDescription
      ? [
          chSql`anyLast(${{ Identifier: 'MetricDescription' }}) AS MetricDescription`,
        ]
      : []),
  ];
  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE MetricName = ${{ String: metricName }}
      AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})
      AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})
  `;
  try {
    const response = await clickhouseClient.query<'JSON'>({
      query: sql.sql,
      query_params: sql.params,
      format: 'JSON',
      connectionId,
      abort_signal: signal,
    });
    const result = (await response.json()) as {
      data: Array<{ MetricUnit?: string; MetricDescription?: string }>;
    };
    const row = result.data[0];
    if (!row) return {};
    return {
      ...(row.MetricUnit ? { unit: row.MetricUnit } : {}),
      ...(row.MetricDescription ? { description: row.MetricDescription } : {}),
    };
  } catch (e) {
    logger.warn(
      { tableName, error: e instanceof Error ? e.message : String(e) },
      'fetchUnitAndDescription failed',
    );
    return {};
  }
}

/**
 * Discover the distinct attribute keys present for a single metric
 * name on a single kind's table, grouped by the Map column they live on
 * (typically ResourceAttributes / Attributes / ScopeAttributes on the
 * OTel Collector default schema). Issues one query per Map column with
 * `mapKeys(col) AS keys` and aggregates the distinct keys server-side.
 *
 * Bounds the scan two ways so it stays fast on production-shaped metric
 * tables (where a single MetricName can match millions of rows):
 *   - WHERE TimeUnix BETWEEN startDate AND endDate scopes to the
 *     discovery window the caller already passed.
 *   - max_rows_to_read caps the per-query scan server-side so a hot
 *     metric cannot starve the wall-clock budget on its own.
 *
 * The earlier inline SQL did neither — an unbounded
 * `WHERE MetricName = ?` scan consistently exceeded the wall-clock
 * timeout on production tables.
 */
async function fetchAttributeKeys({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  metricName,
  columns,
  startDate,
  endDate,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  metricName: string;
  columns: { name: string; type: string }[];
  startDate: Date;
  endDate: Date;
  signal: AbortSignal;
}): Promise<FetchResult<Record<string, string[]>>> {
  const mapColumns =
    filterColumnMetaByType(columns, [JSDataType.Map])?.filter(
      c => convertCHDataTypeToJSType(c.type) === JSDataType.Map,
    ) ?? [];
  if (mapColumns.length === 0) return { ok: true, data: {} };

  const sampleProjections = mapColumns.map(
    col => chSql`${{ Identifier: col.name }}`,
  );

  const aggProjections = mapColumns.map(
    col =>
      chSql`arrayDistinct(arrayFlatten(groupArray(mapKeys(${{ Identifier: col.name }})))) AS ${{ Identifier: col.name }}`,
  );

  // Aggregate from a bounded sample of matching rows. The inner LIMIT
  // lets ClickHouse stop scanning once it has SAMPLE_SIZE rows that
  // match (MetricName, time range), which keeps the query fast on hot
  // metric tables. ResourceAttributes / Attributes / ScopeAttributes
  // are rarely keyed independently per row, so 100k rows surfaces
  // every realistic key set.
  const sql = chSql`
    SELECT ${concatChSql(', ', aggProjections)}
    FROM (
      SELECT ${concatChSql(', ', sampleProjections)}
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      WHERE MetricName = ${{ String: metricName }}
        AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})
        AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})
      LIMIT ${{ Int32: METRIC_ATTR_KEYS_SAMPLE_SIZE }}
    )
  `;

  try {
    const response = await clickhouseClient.query<'JSON'>({
      query: sql.sql,
      query_params: sql.params,
      format: 'JSON',
      connectionId,
      clickhouse_settings: {
        max_execution_time: METRIC_ATTR_KEYS_MAX_EXEC_SECONDS,
        timeout_overflow_mode: 'break',
      },
      abort_signal: signal,
    });
    const result = (await response.json()) as {
      data: Array<Record<string, string[]>>;
    };
    const row = result.data[0];
    if (!row) return { ok: true, data: {} };
    const out: Record<string, string[]> = {};
    for (const col of mapColumns) {
      const keys = row[col.name];
      if (Array.isArray(keys) && keys.length > 0) {
        out[col.name] = keys.filter(k => typeof k === 'string' && k.length > 0);
      }
    }
    return { ok: true, data: out };
  } catch (e) {
    logger.warn(
      { tableName, error: e instanceof Error ? e.message : String(e) },
      'fetchAttributeKeys failed',
    );
    return { ok: false, error: sanitizeFetchError(e) };
  }
}

/**
 * Sample distinct values per attribute key. Uses one composed
 * groupArray-per-key query so all keys are fetched in a single round
 * trip.
 */
async function sampleAttributeValues({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  metricName,
  attributeKeys,
  startDate,
  endDate,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  metricName: string;
  // attributeKeys is shape { mapColumn: keyName[] } e.g. { Attributes: ['http.method', 'http.route'] }
  attributeKeys: Record<string, string[]>;
  startDate: Date;
  endDate: Date;
  signal: AbortSignal;
}): Promise<FetchResult<Record<string, string[]>>> {
  const flatKeyExprs: { display: string; mapColumn: string; key: string }[] =
    [];
  for (const [mapColumn, keys] of Object.entries(attributeKeys)) {
    for (const key of keys) {
      flatKeyExprs.push({
        display: `${mapColumn}['${key}']`,
        mapColumn,
        key,
      });
      if (flatKeyExprs.length >= MAX_ATTR_KEYS_TO_SAMPLE) break;
    }
    if (flatKeyExprs.length >= MAX_ATTR_KEYS_TO_SAMPLE) break;
  }
  if (flatKeyExprs.length === 0) return { ok: true, data: {} };

  const projections = flatKeyExprs.map(
    ({ mapColumn, key }, idx) => chSql`
      groupUniqArray(${{ Int32: MAX_ATTR_VALUES }})(
        ${{ Identifier: mapColumn }}[${{ String: key }}]
      ) AS param${{ UNSAFE_RAW_SQL: String(idx) }}
    `,
  );

  // Distinct set of map columns we need from each sampled row, so the
  // inner subquery only projects what's required for the outer
  // groupUniqArray aggregates.
  const sampledMapColumns = Array.from(
    new Set(flatKeyExprs.map(e => e.mapColumn)),
  );
  const sampleProjections = sampledMapColumns.map(
    col => chSql`${{ Identifier: col }}`,
  );

  // Aggregate from a bounded sample of matching rows. Mirrors
  // fetchAttributeKeys: the inner LIMIT lets ClickHouse stop scanning
  // once it has SAMPLE_SIZE rows that match (MetricName, time range),
  // and the matching clickhouse_settings cap server-side execution so a
  // hot metric cannot starve the wall-clock budget.
  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM (
      SELECT ${concatChSql(', ', sampleProjections)}
      FROM ${tableExpr({ database: databaseName, table: tableName })}
      WHERE MetricName = ${{ String: metricName }}
        AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})
        AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})
      LIMIT ${{ Int32: METRIC_ATTR_KEYS_SAMPLE_SIZE }}
    )
  `;

  try {
    const response = await clickhouseClient.query<'JSON'>({
      query: sql.sql,
      query_params: sql.params,
      format: 'JSON',
      connectionId,
      clickhouse_settings: {
        max_execution_time: METRIC_ATTR_KEYS_MAX_EXEC_SECONDS,
        timeout_overflow_mode: 'break',
      },
      abort_signal: signal,
    });
    const result = (await response.json()) as {
      data: Array<Record<string, string[]>>;
    };
    const row = result.data[0];
    if (!row) return { ok: true, data: {} };
    const values: Record<string, string[]> = {};
    flatKeyExprs.forEach((meta, idx) => {
      const sample = (row[`param${idx}`] ?? []).filter(v => v !== '');
      if (sample.length > 0) {
        values[meta.display] = sample;
      }
    });
    return { ok: true, data: values };
  } catch (e) {
    logger.warn(
      { tableName, error: e instanceof Error ? e.message : String(e) },
      'sampleAttributeValues failed',
    );
    return { ok: false, error: sanitizeFetchError(e) };
  }
}

async function describeMetricImpl(
  teamId: string,
  input: z.infer<typeof describeMetricSchema>,
  signal: AbortSignal,
) {
  const source = await getSource(teamId, input.sourceId);
  if (!source) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Source "${input.sourceId}" not found. Call clickstack_list_sources to see available source IDs.`,
        },
      ],
    };
  }
  if (source.kind !== SourceKind.Metric) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Source "${input.sourceId}" is a "${source.kind}" source, not a metric source. clickstack_describe_metric only works on metric sources.`,
        },
      ],
    };
  }

  const timeRange = parseTimeRange(input.startTime, input.endTime);
  if ('error' in timeRange) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: timeRange.error }],
    };
  }
  const { startDate, endDate } = timeRange;

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Connection not found for source "${input.sourceId}".`,
        },
      ],
    };
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });
  const metadata = getMetadata(clickhouseClient);
  const databaseName = source.from.databaseName;
  const connectionId = source.connection.toString();

  // Validate the requested kind has a populated table on this source.
  // The schema requires `kind`, so we always have an exact target.
  const kind = input.kind;
  const tableName = source.metricTables[kind];
  if (!tableName) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Source "${input.sourceId}" has no "${kind}" metric table populated. Populated kinds: ${Object.keys(source.metricTables).join(', ')}.`,
        },
      ],
    };
  }

  // Defensive column-presence check before referencing MetricUnit /
  // MetricDescription on this kind's table.
  let columns: { name: string; type: string }[];
  try {
    columns = await metadata.getColumns({
      databaseName,
      tableName,
      connectionId,
    });
  } catch (e) {
    logger.warn(
      { kind, error: e instanceof Error ? e.message : String(e) },
      'describeMetric: getColumns failed',
    );
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Failed to load columns for "${tableName}". The metric table may be missing or unreachable.`,
        },
      ],
    };
  }
  const columnNames = new Set(columns.map(c => c.name));
  const hasUnit = columnNames.has('MetricUnit');
  const hasDescription = columnNames.has('MetricDescription');

  const [meta, attributeKeysResult] = await Promise.all([
    fetchUnitAndDescription({
      clickhouseClient,
      databaseName,
      tableName,
      connectionId,
      metricName: input.metricName,
      startDate,
      endDate,
      hasUnit,
      hasDescription,
      signal,
    }),
    fetchAttributeKeys({
      clickhouseClient,
      databaseName,
      tableName,
      connectionId,
      metricName: input.metricName,
      columns,
      startDate,
      endDate,
      signal,
    }),
  ]);

  // Track discovery sub-queries that failed so the agent can distinguish
  // "fetch failed" (retry / report) from "genuinely empty" (widen the
  // window). Without this, transient ClickHouse errors surfaced as the
  // misleading "No data found" hint.
  const partialFailure: { stage: string; error: string }[] = [];
  const attributeKeys = attributeKeysResult.ok ? attributeKeysResult.data : {};
  if (!attributeKeysResult.ok) {
    partialFailure.push({
      stage: 'attributeKeys',
      error: attributeKeysResult.error,
    });
  }

  const kindDetail: KindDetail = {
    kind,
    tableName,
    ...(meta.unit ? { unit: meta.unit } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    attributeKeys,
    usage: KIND_USAGE[kind],
  };

  if (input.sampleValues && Object.keys(attributeKeys).length > 0) {
    const valuesResult = await sampleAttributeValues({
      clickhouseClient,
      databaseName,
      tableName,
      connectionId,
      metricName: input.metricName,
      attributeKeys,
      startDate,
      endDate,
      signal,
    });
    if (valuesResult.ok) {
      kindDetail.attributeValues = valuesResult.data;
    } else {
      partialFailure.push({
        stage: 'attributeValues',
        error: valuesResult.error,
      });
    }
  }

  const kindDetails: KindDetail[] = [kindDetail];

  // Heuristic "no data in this kind" hint: when neither attribute keys,
  // unit, nor description came back, the (metric, kind) pair likely has
  // no data in the requested window. The agent's recourse is to widen
  // startTime/endTime or double-check the kind via clickstack_list_metrics.
  // Suppressed when any discovery stage failed — an empty attributeKeys
  // can't be trusted as "no data" then.
  const noSignal =
    partialFailure.length === 0 &&
    Object.keys(attributeKeys).length === 0 &&
    !meta.unit &&
    !meta.description;

  const queryExample = `clickstack_timeseries({ sourceId: "${input.sourceId}", select: [{ aggFn: ${
    kind === 'sum'
      ? '"increase"'
      : kind === 'histogram'
        ? '"quantile", level: 0.95'
        : '"avg"'
  }, metricType: "${kind}", metricName: "${input.metricName}" }] })`;

  const responseObj: Record<string, unknown> = {
    metricName: input.metricName,
    kinds: kindDetails,
    ...(partialFailure.length > 0 && {
      partialFailure,
      hint:
        'Some discovery queries failed — the fields above may be incomplete. ' +
        'Retry the call; if the failure persists, narrow startTime/endTime or set sampleValues:false.',
    }),
    ...(noSignal && {
      hint:
        `No data found for MetricName "${input.metricName}" with kind "${kind}" ` +
        `between ${startDate.toISOString()} and ${endDate.toISOString()}. ` +
        'Try widening startTime/endTime, or call clickstack_list_metrics to ' +
        'confirm the metric name + kind combination exists.',
    }),
    nextSteps: {
      query: `Example: ${queryExample}`,
    },
  };

  const { data: trimmed, isTrimmed } = trimToolResponse(responseObj);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          isTrimmed
            ? {
                ...trimmed,
                note: 'Result was trimmed for context size. Set sampleValues:false or narrow startTime/endTime.',
              }
            : trimmed,
          null,
          2,
        ),
      },
    ],
  };
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerDescribeMetric(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'clickstack_describe_metric',
    {
      title: 'Describe Metric',
      description:
        'DRILL-DOWN: Use after clickstack_list_metrics (or after a clickstack_describe_source ' +
        'sample) to get attribute keys, sampled values, unit, and description for a ' +
        'specific (metricName, kind) pair. Attribute keys vary per metric — not per source — ' +
        "so always call this before clickstack_timeseries / clickstack_table for any metric you've never queried.\n\n" +
        'REQUIRES `kind` — pass the gauge/sum/histogram value emitted alongside the metric name by ' +
        'clickstack_list_metrics or clickstack_describe_source. A metric name can legitimately ' +
        'live in more than one kind (e.g. "container.cpu.usage" appears in both gauge and sum); ' +
        'call this tool once per kind you care about.\n\n' +
        'Workflow: clickstack_list_sources → clickstack_list_metrics → ' +
        'clickstack_describe_metric → clickstack_timeseries|clickstack_table.',
      inputSchema: describeMetricSchema,
    },
    withToolTracing('clickstack_describe_metric', context, async rawInput => {
      // Re-parse explicitly: the MCP SDK callback signature widens
      // optional-field types into `unknown`, but the parser produces
      // the typed shape we need for downstream calls.
      const input = describeMetricSchema.parse(rawInput);
      const controller = new AbortController();
      // Hoist the timer handle so the finally block can cancel it on the
      // success path — otherwise a stale controller.abort() fires
      // DESCRIBE_TIMEOUT_MS after every successful call and the
      // setTimeout closure stays pinned for the same duration.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error('DESCRIBE_METRIC_TIMEOUT'));
        }, DESCRIBE_TIMEOUT_MS);
      });
      try {
        return await Promise.race([
          describeMetricImpl(teamId.toString(), input, controller.signal),
          timeoutPromise,
        ]);
      } catch (e) {
        if (e instanceof Error && e.message === 'DESCRIBE_METRIC_TIMEOUT') {
          logger.warn(
            { teamId, sourceId: input.sourceId, metricName: input.metricName },
            'clickstack_describe_metric timed out',
          );
          return {
            isError: true as const,
            content: [
              {
                type: 'text' as const,
                text:
                  'Discovery timed out. The metric table may be under load or the ' +
                  'attribute set may be very high-cardinality. Try narrowing ' +
                  'startTime/endTime or setting sampleValues:false to skip the ' +
                  'value-sampling stage.',
              },
            ],
          };
        }
        throw e;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    }),
  );
}
