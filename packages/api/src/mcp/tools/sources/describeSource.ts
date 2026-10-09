import {
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { type MetricTable, SourceKind } from '@hyperdx/common-utils/dist/types';
import { trace } from '@opentelemetry/api';
import SqlString from 'sqlstring';
import { z } from 'zod';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import type { ToolRegistrar, ToolResult } from '@/mcp/tools/types';
import { mcpServerError, mcpUserError } from '@/mcp/utils/errors';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';

import {
  DISCOVERABLE_METRIC_KINDS,
  QUERYABLE_METRIC_KINDS,
  type QueryableMetricKind,
  sanitizeMetricTables,
} from './metricKinds';
import {
  type MetricNameSample,
  sampleMetricNamesWithLookback,
} from './metricNames';
import { extractSourceConfig } from './schemas';

// How far back to look when querying the rollup tables for value samples.
const VALUE_SAMPLE_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

// When discovery's signal is aborted; it then returns what it has so far.
// Matches the 30s budget of the other MCP query tools.
export const DESCRIBE_TIMEOUT_MS = 30_000;

// Extra time after the abort before the handler stops waiting, in case a
// ClickHouse call ignores the signal. 30s + 2s lines up with
// MCP_REQUEST_TIMEOUT in query/helpers.ts.
export const DESCRIBE_BACKSTOP_MS = 2_000;

const BACKSTOP = Symbol('backstop');

// Max sampled values per low-cardinality column / map attribute key.
const MAX_LC_VALUES = 20;
const MAX_MAP_KEY_VALUES = 5;
const MAX_MAP_KEYS_TO_SAMPLE = 10;

/**
 * Pick the representative metric table to use as the starting point for
 * schema/attribute discovery on a metric source. Prefers gauge → sum →
 * histogram → exponential histogram from the source's populated metricTables
 * map. Returns the ClickHouse table name, or undefined when no queryable metric
 * table is populated.
 */
function pickRepresentativeMetricTable(
  metricTables: MetricTable,
): { kind: QueryableMetricKind; tableName: string } | undefined {
  for (const kind of QUERYABLE_METRIC_KINDS) {
    const tableName = metricTables[kind];
    if (tableName) {
      return { kind, tableName };
    }
  }
  return undefined;
}

type DescribeProgress = {
  /**
   * Set once the column schema has loaded. Renders everything gathered so far,
   * with unfinished stages listed in skippedStages, so the handler can still
   * answer if discovery is stuck past the backstop.
   */
  snapshot?: () => ToolResult;
  /** Set on the final result: whether any stage was cut short. */
  partial?: boolean;
};

/**
 * Core schema-discovery logic. Stages after the column schema stop when
 * `signal` aborts, and the result is flagged partial.
 */
async function describeSourceSchema(
  teamId: string,
  sourceId: string,
  signal: AbortSignal,
  progress: DescribeProgress,
): Promise<ToolResult> {
  const source = await getSource(teamId, sourceId);
  if (!source) {
    return mcpUserError(
      `Source "${sourceId}" not found. Call clickstack_list_sources to see available source IDs.`,
    );
  }

  const meta: Record<string, unknown> = {
    id: source._id.toString(),
    name: source.name,
    kind: source.kind,
    connectionId: source.connection.toString(),
    timestampColumn: source.timestampValueExpression,
    // Round-trippable config for clickstack_save_source (clone / read-modify-
    // write); includes fields the curated summary below omits.
    config: extractSourceConfig(source.toObject()),
  };

  if (source.section) {
    meta.section = source.section;
  }

  if (
    'eventAttributesExpression' in source &&
    source.eventAttributesExpression
  ) {
    meta.eventAttributesColumn = source.eventAttributesExpression;
  }
  if (
    'resourceAttributesExpression' in source &&
    source.resourceAttributesExpression
  ) {
    meta.resourceAttributesColumn = source.resourceAttributesExpression;
  }

  // Key columns by source kind
  let representativeMetric:
    | { kind: QueryableMetricKind; tableName: string }
    | undefined;
  if (source.kind === SourceKind.Trace) {
    meta.keyColumns = {
      spanName: source.spanNameExpression,
      duration: source.durationExpression,
      durationPrecision: source.durationPrecision,
      statusCode: source.statusCodeExpression,
      serviceName: source.serviceNameExpression,
      traceId: source.traceIdExpression,
      spanId: source.spanIdExpression,
    };
  } else if (source.kind === SourceKind.Log) {
    meta.keyColumns = {
      body: source.bodyExpression,
      serviceName: source.serviceNameExpression,
      severityText: source.severityTextExpression,
      traceId: source.traceIdExpression,
    };
  } else if (source.kind === SourceKind.Netflow) {
    meta.keyColumns = {
      bytes: source.bytesExpression,
      packets: source.packetsExpression,
      samplingRate: source.samplingRateExpression,
      srcAddr: source.srcAddrExpression,
      dstAddr: source.dstAddrExpression,
      srcPort: source.srcPortExpression,
      dstPort: source.dstPortExpression,
      protocol: source.protocolExpression,
      exporter: source.exporterExpression,
      inIf: source.inIfExpression,
      outIf: source.outIfExpression,
    };
  } else if (source.kind === SourceKind.Metric) {
    // Filter out implementation-detail keys (e.g. a stray Mongoose `_id`
    // on the metricTables subdoc) so the agent only sees valid metric
    // kinds.
    const tables = sanitizeMetricTables(
      source.metricTables as Record<string, unknown> | undefined,
    );
    if (tables) meta.metricTables = tables;
    representativeMetric = pickRepresentativeMetricTable(source.metricTables);
    if (representativeMetric) {
      meta.discoveryMetricKind = representativeMetric.kind;
    }
  }

  // Resolve the table name we'll use for column / map-key / value
  // discovery. For non-metric sources this is just source.from.tableName.
  // For metric sources we use the representative metric table picked
  // above (gauge → sum → histogram → exponential histogram).
  const discoveryTableName =
    source.from.tableName || representativeMetric?.tableName || '';

  // Only early-return when there is truly no table to discover schema
  // against (e.g. a metric source with no populated metric tables).
  if (!discoveryTableName) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              source: meta,
              nextSteps: {
                query: `Use clickstack_timeseries, clickstack_table, or clickstack_search with sourceId "${sourceId}".`,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return mcpUserError(`Connection not found for source "${sourceId}".`);
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });
  const metadata = getMetadata(clickhouseClient);
  const databaseName = source.from.databaseName;
  const tableName = discoveryTableName;
  const connectionId = source.connection.toString();

  // Track which sampling stages were skipped due to timeout
  const skippedStages: string[] = [];

  // Shared by stages 2–4 so map-key discovery can use rollup tables
  // instead of falling back to expensive main-table scans.
  const metadataMVs =
    'metadataMaterializedViews' in source
      ? source.metadataMaterializedViews
      : undefined;

  const now = new Date();
  const dateRange: [Date, Date] = [
    new Date(now.getTime() - VALUE_SAMPLE_LOOKBACK_MS),
    now,
  ];

  // ── 1. Column schema ──────────────────────────────────────────────────
  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });

  meta.columns = columns.map(c => ({
    name: c.name,
    type: c.type,
    jsType: convertCHDataTypeToJSType(c.type),
  }));

  const isMetricSource = source.kind === SourceKind.Metric;
  const mapColumns = filterColumnMetaByType(columns, [JSDataType.Map]) ?? [];
  const lcColumns = columns.filter(c => {
    const normalized = c.type.replace(/\s/g, '');
    return (
      normalized.startsWith('LowCardinality(') &&
      (normalized.includes('String') || normalized.includes('string'))
    );
  });
  const metricKinds =
    source.kind === SourceKind.Metric
      ? DISCOVERABLE_METRIC_KINDS.flatMap(kind => {
          const kindTableName = source.metricTables[kind];
          return kindTableName ? [{ kind, kindTableName }] : [];
        })
      : [];
  // Stages with nothing to sample can't be skipped, so the snapshot must not
  // report them as missing.
  const optionalStages = [
    ...(mapColumns.length > 0 ? ['mapAttributeKeys'] : []),
    ...(lcColumns.length > 0 ? ['lowCardinalityValues'] : []),
    ...(mapColumns.length > 0 ? ['mapAttributeValues'] : []),
    ...(metricKinds.length > 0 ? ['metricNames'] : []),
  ];
  const finishedStages = new Set<string>();
  progress.snapshot = () =>
    formatDescribeResult({
      sourceId,
      meta,
      isMetricSource,
      skippedStages: [
        ...skippedStages,
        ...optionalStages.filter(
          s => !finishedStages.has(s) && !skippedStages.includes(s),
        ),
      ],
    });

  // ── 2. Map attribute keys ─────────────────────────────────────────────
  // timestampValueExpression is threaded into getMapKeys / getAllKeyValues /
  // sampleMetricNamesForKind below so the no-rollup fallback path (i.e.
  // metric sources, which don't have metadataMaterializedViews configured)
  // can scope its scan to dateRange instead of going unbounded against
  // the raw metric table on cold cache.
  const timestampValueExpression = source.timestampValueExpression;
  const mapKeysResults: Record<string, string[]> = {};

  if (!signal.aborted) {
    await Promise.all(
      mapColumns.map(async col => {
        try {
          const keys = await metadata.getMapKeys({
            databaseName,
            tableName,
            column: col.name,
            maxKeys: 50,
            connectionId,
            metadataMVs,
            dateRange,
            timestampValueExpression,
            signal,
          });
          mapKeysResults[col.name] = keys;
          // Visible to the backstop snapshot before the other columns finish.
          meta.mapAttributeKeys = mapKeysResults;
        } catch (e) {
          logger.warn(
            { sourceId, column: col.name, error: e },
            'Failed to fetch map keys for column',
          );
        }
      }),
    );
  }

  // Any column still missing at the abort means the key list is incomplete.
  if (
    signal.aborted &&
    Object.keys(mapKeysResults).length < mapColumns.length
  ) {
    skippedStages.push('mapAttributeKeys');
  }
  finishedStages.add('mapAttributeKeys');
  // No keys and no abort means stage 4 has nothing to sample. No keys because
  // of the abort means it was never sampled, matching the backstop snapshot.
  if (Object.keys(mapKeysResults).length === 0) {
    if (signal.aborted && mapColumns.length > 0) {
      skippedStages.push('mapAttributeValues');
    }
    finishedStages.add('mapAttributeValues');
  }

  // ── 3. Low-cardinality column value sampling ──────────────────────────
  const lowCardinalityValues: Record<string, string[]> = {};

  if (lcColumns.length > 0 && !signal.aborted) {
    try {
      const results = await metadata.getAllKeyValues({
        databaseName,
        tableName,
        keyExpressions: lcColumns.map(col => col.name),
        maxValuesPerKey: MAX_LC_VALUES,
        connectionId,
        metadataMVs,
        dateRange,
        timestampValueExpression,
        signal,
      });
      for (const { key, value } of results) {
        if (value.length > 0) {
          lowCardinalityValues[key] = value.map(v => v.toString());
        }
      }
    } catch {
      // Skip columns where value sampling fails
    }
  }

  // getAllKeyValues drops aborted chunks instead of throwing, so any result
  // returned after the abort may be missing keys.
  if (lcColumns.length > 0 && signal.aborted) {
    skippedStages.push('lowCardinalityValues');
  }
  if (Object.keys(lowCardinalityValues).length > 0) {
    meta.lowCardinalityValues = lowCardinalityValues;
  }
  finishedStages.add('lowCardinalityValues');

  // ── 4. Map attribute value sampling (best-effort) ─────────────────────
  if (Object.keys(mapKeysResults).length > 0 && !signal.aborted) {
    const mapAttributeValues: Record<string, string[]> = {};

    const keyExprs: string[] = [];
    for (const [colName, keys] of Object.entries(mapKeysResults)) {
      for (const key of keys.slice(0, MAX_MAP_KEYS_TO_SAMPLE)) {
        // Map keys come from ClickHouse data (customer telemetry) so they can
        // contain arbitrary characters, including single quotes. Escape as a
        // SQL string literal — `SqlString.escape` returns a fully-quoted,
        // safely-escaped value — before embedding in the key expression.
        keyExprs.push(`${colName}[${SqlString.escape(key)}]`);
      }
    }

    try {
      const results = await metadata.getAllKeyValues({
        databaseName,
        tableName,
        keyExpressions: keyExprs,
        maxValuesPerKey: MAX_MAP_KEY_VALUES,
        connectionId,
        metadataMVs,
        dateRange,
        timestampValueExpression,
        signal,
      });
      for (const { key, value } of results) {
        if (value.length > 0) {
          mapAttributeValues[key] = value.map(v => v.toString());
        }
      }
    } catch {
      // Best-effort; skip on failure
    }

    if (signal.aborted) {
      skippedStages.push('mapAttributeValues');
    }
    if (Object.keys(mapAttributeValues).length > 0) {
      meta.mapAttributeValues = mapAttributeValues;
    }
  } else if (Object.keys(mapKeysResults).length > 0) {
    // Signal was already aborted before we started this stage
    skippedStages.push('mapAttributeValues');
  }
  finishedStages.add('mapAttributeValues');

  // ── 5. Metric name + unit + description sampling ──────────────────────
  // For metric sources, sample distinct MetricName values per discoverable
  // kind (including the non-queryable summary kind, so agents know those
  // metrics exist) so the agent has a starter list without needing a
  // follow-up call to clickstack_list_metrics for the common case
  // (<= 20 metrics/kind).
  // Defensively check for MetricUnit / MetricDescription columns: they
  // exist on the standard OTel Collector schema but a custom metric table
  // may not declare them.
  if (metricKinds.length > 0 && !signal.aborted) {
    const metricNames: Record<string, MetricNameSample[]> = {};
    let sampledKinds = 0;
    await Promise.all(
      metricKinds.map(async ({ kind, kindTableName }) => {
        try {
          const samples = await sampleMetricNamesWithLookback({
            metadata,
            clickhouseClient,
            databaseName,
            tableName: kindTableName,
            connectionId,
            now,
            timestampValueExpression,
            signal,
          });
          // The sampler returns [] rather than throwing when aborted, so an
          // empty result after the abort may just be a cut-short lookback.
          if (samples.length > 0 || !signal.aborted) sampledKinds++;
          if (samples.length > 0) {
            metricNames[kind] = samples;
            meta.metricNames = metricNames;
          }
        } catch (e) {
          logger.warn(
            { sourceId, kind, error: e },
            'Failed to sample metric names for kind',
          );
        }
      }),
    );
    if (signal.aborted && sampledKinds < metricKinds.length) {
      skippedStages.push('metricNames');
    }
  } else if (metricKinds.length > 0) {
    skippedStages.push('metricNames');
  }
  finishedStages.add('metricNames');

  progress.partial = skippedStages.length > 0;
  return formatDescribeResult({
    sourceId,
    meta,
    isMetricSource,
    skippedStages,
  });
}

function formatDescribeResult({
  sourceId,
  meta,
  isMetricSource,
  skippedStages,
}: {
  sourceId: string;
  meta: Record<string, unknown>;
  isMetricSource: boolean;
  skippedStages: string[];
}): ToolResult {
  // Flag partial results so the LLM knows value samples may be incomplete.
  // Copy rather than mutate: the backstop snapshot renders `meta` while
  // discovery may still be writing to it.
  const source =
    skippedStages.length > 0 ? { ...meta, partial: true, skippedStages } : meta;

  const lcValuesHint =
    skippedStages.length > 0
      ? 'Value sampling was partially skipped due to timeout. ' +
        'The values shown may be incomplete — verify with a clickstack_search query if needed.'
      : 'These are the REAL values in your data — use them in filters instead of guessing. ' +
        'Example: where: "SeverityText:error" (if \'error\' appears in the sampled values above).';

  const queryNextStep = isMetricSource
    ? `Use clickstack_timeseries or clickstack_table with sourceId "${sourceId}" and metricType/metricName from above. ` +
      'Summary metrics (metricTables.summary) are not supported by those tools — ' +
      "query the summary table with clickstack_sql using this source's connectionId."
    : `Use clickstack_timeseries, clickstack_table, or clickstack_search with sourceId "${sourceId}" and the columns/attributes above.`;
  const discoveryNextStep = isMetricSource
    ? `For more metric names than the sample above, call clickstack_list_metrics with sourceId "${sourceId}". For per-metric attribute keys + sampled values, call clickstack_describe_metric with sourceId and metricName.`
    : undefined;

  const { data: output, isTrimmed } = trimToolResponse({
    source,
    usage: {
      topLevelColumns:
        'Use directly in valueExpression/groupBy with PascalCase: Duration, StatusCode, SpanName',
      mapAttributes:
        "Use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']",
      lowCardinalityValues: lcValuesHint,
      ...(isMetricSource && {
        metricNames:
          'Each entry maps a metric kind (gauge/sum/histogram/exponential histogram/summary) to a sample of metric names ' +
          'available on that table. Pass metricType + metricName on each select item. ' +
          'EXCEPTION: summary metrics cannot be charted — query them with clickstack_sql ' +
          "against the table in metricTables.summary using this source's connectionId.",
      }),
    },
    nextSteps: {
      query: queryNextStep,
      mapAttributeAccess:
        "Use bracket syntax for map columns: ResourceAttributes['service.name'], SpanAttributes['http.method']",
      ...(discoveryNextStep && { discovery: discoveryNextStep }),
    },
  });

  const finalOutput = isTrimmed
    ? {
        ...output,
        note: 'Result was trimmed for context size. Some columns or sampled values may be omitted.',
      }
    : output;

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(finalOutput),
      },
    ],
  };
}

export function registerDescribeSource({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_describe_source',
    {
      title: 'Describe Source Schema',
      annotations: { readOnlyHint: true },
      description:
        'CALL THIS BEFORE WRITING QUERIES — prevents unknown-column errors.\n\n' +
        'Returns the full column schema, map-attribute keys, and sampled low-cardinality ' +
        'values (e.g. SeverityText, StatusCode, ServiceName) for a single data source.\n\n' +
        'Workflow: call clickstack_list_sources first to get source IDs, then call this tool ' +
        'for each source you plan to query.\n\n' +
        'Returns:\n' +
        '- columns[]: column name, ClickHouse type, and JS type\n' +
        '- mapAttributeKeys: discovered keys in Map columns (e.g. SpanAttributes, ResourceAttributes)\n' +
        '- lowCardinalityValues: sampled values for LowCardinality(String) columns ' +
        '(SeverityText, StatusCode, ServiceName, etc.) — use these in filters instead of guessing\n' +
        '- mapAttributeValues: sampled top values for the most common map attribute keys ' +
        "(e.g. ResourceAttributes['service.name'] top values) — requires rollup tables\n\n" +
        `Value sampling stops after ${DESCRIBE_TIMEOUT_MS / 1000} seconds. If it is cut short, the result still includes ` +
        'the columns and sets partial: true with skippedStages listing what is missing.\n\n' +
        'Cost: one describe call prevents 3–5 exploratory queries against non-existent columns.',
      inputSchema: z.object({
        sourceId: z
          .string()
          .describe(
            'The source ID to describe. Get this from clickstack_list_sources.',
          ),
      }),
    },
    async ({ sourceId }) => {
      const controller = new AbortController();
      const progress: DescribeProgress = {};

      // At the deadline, abort so discovery skips its remaining stages and
      // returns what it has. The backstop covers ClickHouse calls that
      // ignore the signal: it answers from the latest snapshot instead of
      // waiting on them.
      const abortTimer = setTimeout(
        () => controller.abort(),
        DESCRIBE_TIMEOUT_MS,
      );
      let backstopTimer: ReturnType<typeof setTimeout> | undefined;
      const backstop = new Promise<typeof BACKSTOP>(resolve => {
        backstopTimer = setTimeout(
          () => resolve(BACKSTOP),
          DESCRIBE_TIMEOUT_MS + DESCRIBE_BACKSTOP_MS,
        );
      });

      const span = trace.getActiveSpan();
      const recordOutcome = (
        outcome: 'complete' | 'partial' | 'timeout' | 'error',
      ) => {
        span?.setAttribute('mcp.describe_source.outcome', outcome);
        if (outcome === 'partial' || outcome === 'timeout') {
          logger.warn(
            { teamId, sourceId, outcome },
            'clickstack_describe_source hit its deadline',
          );
        }
      };
      const timedOutResult = () => {
        if (progress.snapshot) {
          recordOutcome('partial');
          return progress.snapshot();
        }
        recordOutcome('timeout');
        return mcpServerError(
          'Schema discovery timed out before the column schema loaded. ' +
            'The ClickHouse server may be under load. Try again, or use ' +
            'clickstack_list_sources for basic source info without schema details.',
        );
      };

      try {
        const result = await Promise.race([
          describeSourceSchema(
            teamId.toString(),
            sourceId,
            controller.signal,
            progress,
          ),
          backstop,
        ]);
        if (result === BACKSTOP) {
          return timedOutResult();
        }
        recordOutcome(
          result.isError ? 'error' : progress.partial ? 'partial' : 'complete',
        );
        return result;
      } catch (e) {
        if (controller.signal.aborted) {
          return timedOutResult();
        }
        logger.warn(
          { teamId, sourceId, error: e },
          'Failed to describe source schema',
        );
        throw e;
      } finally {
        clearTimeout(abortTimer);
        clearTimeout(backstopTimer);
      }
    },
  );
}
