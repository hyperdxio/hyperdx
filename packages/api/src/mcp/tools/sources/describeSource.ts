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
import { type MetricTable, SourceKind } from '@hyperdx/common-utils/dist/types';
import SqlString from 'sqlstring';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpServerError, mcpUserError } from '@/mcp/utils/errors';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';

import {
  QUERYABLE_METRIC_KINDS,
  type QueryableMetricKind,
  sanitizeMetricTables,
} from './metricKinds';
import { extractSourceConfig } from './schemas';

// How far back to look when querying the rollup tables for value samples.
const VALUE_SAMPLE_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

// Hard timeout for the entire describe operation (ms).
const DESCRIBE_TIMEOUT_MS = 10_000;

// Max sampled values per low-cardinality column / map attribute key.
const MAX_LC_VALUES = 20;
const MAX_MAP_KEY_VALUES = 5;
const MAX_MAP_KEYS_TO_SAMPLE = 10;

// Max MetricName values returned per metric kind by the starter sample.
// clickstack_list_metrics provides paginated discovery beyond this cap.
const MAX_METRIC_NAMES_PER_KIND = 20;

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

type MetricNameSample = {
  name: string;
  unit?: string;
  description?: string;
};

/**
 * Sample distinct MetricName values for a single metric kind. Optionally
 * enriches each name with MetricUnit / MetricDescription when those
 * columns are present on the table (the OTel Collector default schema
 * includes them; custom schemas may not).
 */
async function sampleMetricNamesForKind({
  metadata,
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  dateRange,
  timestampValueExpression,
  signal,
  cachedColumns,
}: {
  metadata: ReturnType<typeof getMetadata>;
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  dateRange: [Date, Date];
  timestampValueExpression: string;
  signal: AbortSignal;
  cachedColumns?: { name: string }[];
}): Promise<MetricNameSample[]> {
  // Defensive column presence check for MetricUnit / MetricDescription.
  const kindColumns =
    cachedColumns ??
    (await metadata.getColumns({ databaseName, tableName, connectionId }));
  const columnNames = new Set(kindColumns.map(c => c.name));
  const hasUnit = columnNames.has('MetricUnit');
  const hasDescription = columnNames.has('MetricDescription');

  // First fetch the distinct metric names; this is the only step that
  // strictly needs to succeed for the kind to appear in the response.
  // Pass timestampValueExpression so the no-rollup fallback path scopes
  // its scan to dateRange instead of going unbounded against the raw
  // metric table on cold cache.
  const nameResults = await metadata.getAllKeyValues({
    databaseName,
    tableName,
    keyExpressions: ['MetricName'],
    maxValuesPerKey: MAX_METRIC_NAMES_PER_KIND,
    connectionId,
    dateRange,
    timestampValueExpression,
    signal,
  });
  const names = nameResults[0]?.value.map(v => v.toString()) ?? [];
  if (names.length === 0) return [];

  // Best-effort enrichment with unit + description. One small query
  // returns one row per metric name with the most-recent unit / desc.
  let enrichments: Record<string, { unit?: string; description?: string }> = {};
  if ((hasUnit || hasDescription) && !signal.aborted) {
    try {
      enrichments = await fetchMetricNameEnrichments({
        clickhouseClient,
        databaseName,
        tableName,
        connectionId,
        names,
        dateRange,
        hasUnit,
        hasDescription,
        signal,
      });
    } catch (e) {
      logger.warn(
        { databaseName, tableName, error: e },
        'Failed to enrich metric names with unit/description',
      );
    }
  }

  return names.map(name => {
    const enrichment = enrichments[name] ?? {};
    const sample: MetricNameSample = { name };
    if (enrichment.unit) sample.unit = enrichment.unit;
    if (enrichment.description) sample.description = enrichment.description;
    return sample;
  });
}

/**
 * Fetch MetricUnit and MetricDescription for a batch of metric names.
 * Uses `anyLast` so the most-recent value wins when a metric has changed
 * unit/description over time.
 */
async function fetchMetricNameEnrichments({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  names,
  dateRange,
  hasUnit,
  hasDescription,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  names: string[];
  dateRange: [Date, Date];
  hasUnit: boolean;
  hasDescription: boolean;
  signal: AbortSignal;
}): Promise<Record<string, { unit?: string; description?: string }>> {
  // Build the projection fragments via the parameterised chSql DSL so
  // identifiers are quoted and the unit/description columns only appear
  // when present on the source table.
  const projections = [
    chSql`MetricName`,
    ...(hasUnit
      ? [chSql`anyLast(${{ Identifier: 'MetricUnit' }}) AS MetricUnit`]
      : []),
    ...(hasDescription
      ? [
          chSql`anyLast(${{ Identifier: 'MetricDescription' }}) AS MetricDescription`,
        ]
      : []),
  ];
  const namePlaceholders = concatChSql(
    ',',
    names.map(name => chSql`${{ String: name }}`),
  );
  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE MetricName IN (${namePlaceholders})
      AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: dateRange[0].getTime() }})
      AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: dateRange[1].getTime() }})
    GROUP BY MetricName
  `;

  type EnrichmentRow = {
    MetricName: string;
    MetricUnit?: string;
    MetricDescription?: string;
  };

  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    abort_signal: signal,
  });
  const result = (await response.json()) as { data: EnrichmentRow[] };

  const enrichments: Record<string, { unit?: string; description?: string }> =
    {};
  for (const row of result.data) {
    enrichments[row.MetricName] = {
      ...(row.MetricUnit ? { unit: row.MetricUnit } : {}),
      ...(row.MetricDescription ? { description: row.MetricDescription } : {}),
    };
  }
  return enrichments;
}

/**
 * Core schema-discovery logic. Extracted so the caller can wrap it in
 * Promise.race for wall-clock timeout enforcement.
 */
async function describeSourceSchema(
  teamId: string,
  sourceId: string,
  signal: AbortSignal,
) {
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

  // ── 2. Map attribute keys ─────────────────────────────────────────────
  // timestampValueExpression is threaded into getMapKeys / getAllKeyValues /
  // sampleMetricNamesForKind below so the no-rollup fallback path (i.e.
  // metric sources, which don't have metadataMaterializedViews configured)
  // can scope its scan to dateRange instead of going unbounded against
  // the raw metric table on cold cache.
  const timestampValueExpression = source.timestampValueExpression;
  const mapColumns = filterColumnMetaByType(columns, [JSDataType.Map]);
  const mapKeysResults: Record<string, string[]> = {};

  if (!signal.aborted) {
    await Promise.all(
      (mapColumns ?? []).map(async col => {
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
        } catch (e) {
          logger.warn(
            { sourceId, column: col.name, error: e },
            'Failed to fetch map keys for column',
          );
        }
      }),
    );
  }

  if (signal.aborted && Object.keys(mapKeysResults).length === 0) {
    skippedStages.push('mapAttributeKeys');
  }
  if (Object.keys(mapKeysResults).length > 0) {
    meta.mapAttributeKeys = mapKeysResults;
  }

  // ── 3. Low-cardinality column value sampling ──────────────────────────
  const lcColumns = columns.filter(c => {
    const normalized = c.type.replace(/\s/g, '');
    return (
      normalized.startsWith('LowCardinality(') &&
      (normalized.includes('String') || normalized.includes('string'))
    );
  });

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

  if (signal.aborted && Object.keys(lowCardinalityValues).length === 0) {
    skippedStages.push('lowCardinalityValues');
  }
  if (Object.keys(lowCardinalityValues).length > 0) {
    meta.lowCardinalityValues = lowCardinalityValues;
  }

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

    if (signal.aborted && Object.keys(mapAttributeValues).length === 0) {
      skippedStages.push('mapAttributeValues');
    }
    if (Object.keys(mapAttributeValues).length > 0) {
      meta.mapAttributeValues = mapAttributeValues;
    }
  } else if (Object.keys(mapKeysResults).length > 0) {
    // Signal was already aborted before we started this stage
    skippedStages.push('mapAttributeValues');
  }

  // ── 5. Metric name + unit + description sampling ──────────────────────
  // For metric sources, sample distinct MetricName values per queryable
  // kind so the agent has a starter list without needing a follow-up call
  // to clickstack_list_metrics for the common case (<= 20 metrics/kind).
  // Defensively check for MetricUnit / MetricDescription columns: they
  // exist on the standard OTel Collector schema but a custom metric table
  // may not declare them.
  if (source.kind === SourceKind.Metric && !signal.aborted) {
    const metricNames: Record<string, MetricNameSample[]> = {};
    await Promise.all(
      QUERYABLE_METRIC_KINDS.map(async kind => {
        const kindTableName = source.metricTables[kind];
        if (!kindTableName) return;
        try {
          const samples = await sampleMetricNamesForKind({
            metadata,
            clickhouseClient,
            databaseName,
            tableName: kindTableName,
            connectionId,
            dateRange,
            timestampValueExpression,
            signal,
            // Reuse representative columns when the kind matches the
            // representative table to avoid a second getColumns round-trip.
            cachedColumns:
              representativeMetric?.tableName === kindTableName
                ? columns
                : undefined,
          });
          if (samples.length > 0) {
            metricNames[kind] = samples;
          }
        } catch (e) {
          logger.warn(
            { sourceId, kind, error: e },
            'Failed to sample metric names for kind',
          );
        }
      }),
    );
    if (signal.aborted && Object.keys(metricNames).length === 0) {
      skippedStages.push('metricNames');
    }
    if (Object.keys(metricNames).length > 0) {
      meta.metricNames = metricNames;
    }
  }

  // Flag partial results so the LLM knows value samples may be incomplete
  if (skippedStages.length > 0) {
    meta.partial = true;
    meta.skippedStages = skippedStages;
  }

  const lcValuesHint =
    skippedStages.length > 0
      ? 'Value sampling was partially skipped due to timeout. ' +
        'The values shown may be incomplete — verify with a clickstack_search query if needed.'
      : 'These are the REAL values in your data — use them in filters instead of guessing. ' +
        'Example: where: "SeverityText:error" (if \'error\' appears in the sampled values above).';

  const isMetricSource = source.kind === SourceKind.Metric;
  const queryNextStep = isMetricSource
    ? `Use clickstack_timeseries or clickstack_table with sourceId "${sourceId}" and metricType/metricName from above.`
    : `Use clickstack_timeseries, clickstack_table, or clickstack_search with sourceId "${sourceId}" and the columns/attributes above.`;
  const discoveryNextStep = isMetricSource
    ? `For more metric names than the sample above, call clickstack_list_metrics with sourceId "${sourceId}". For per-metric attribute keys + sampled values, call clickstack_describe_metric with sourceId and metricName.`
    : undefined;

  const { data: output, isTrimmed } = trimToolResponse({
    source: meta,
    usage: {
      topLevelColumns:
        'Use directly in valueExpression/groupBy with PascalCase: Duration, StatusCode, SpanName',
      mapAttributes:
        "Use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']",
      lowCardinalityValues: lcValuesHint,
      ...(isMetricSource && {
        metricNames:
          'Each entry maps a metric kind (gauge/sum/histogram/exponential histogram) to a sample of metric names ' +
          'available on that table. Pass metricType + metricName on each select item.',
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

      // Promise.race enforces wall-clock timeout regardless of whether
      // internal ClickHouse calls honour the AbortSignal. Hoist the
      // timer handle so the finally block can cancel it on the success
      // path — otherwise a stale controller.abort() fires
      // DESCRIBE_TIMEOUT_MS after every successful call and the
      // setTimeout closure stays pinned for the same duration.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error('DESCRIBE_TIMEOUT'));
        }, DESCRIBE_TIMEOUT_MS);
      });

      try {
        return await Promise.race([
          describeSourceSchema(teamId.toString(), sourceId, controller.signal),
          timeoutPromise,
        ]);
      } catch (e) {
        if (e instanceof Error && e.message === 'DESCRIBE_TIMEOUT') {
          logger.warn(
            { teamId, sourceId },
            'clickstack_describe_source timed out',
          );
          return mcpServerError(
            'Schema discovery timed out. The ClickHouse server may be under load. ' +
              'Try again, or use clickstack_list_sources for basic source info without schema details.',
          );
        }
        logger.warn(
          { teamId, sourceId, error: e },
          'Failed to describe source schema',
        );
        throw e;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    },
  );
}
