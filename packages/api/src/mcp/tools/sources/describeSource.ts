import {
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
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

// How far back to look when querying the rollup tables for value samples.
const VALUE_SAMPLE_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

// Hard timeout for the entire describe operation (ms).
const DESCRIBE_TIMEOUT_MS = 10_000;

// Max sampled values per low-cardinality column / map attribute key.
const MAX_LC_VALUES = 20;
const MAX_MAP_KEY_VALUES = 5;
const MAX_MAP_KEYS_TO_SAMPLE = 10;

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
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Source "${sourceId}" not found. Call hyperdx_list_sources to see available source IDs.`,
        },
      ],
    };
  }

  const meta: Record<string, unknown> = {
    id: source._id.toString(),
    name: source.name,
    kind: source.kind,
    connectionId: source.connection.toString(),
    timestampColumn: source.timestampValueExpression,
  };

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
    meta.metricTables = source.metricTables;
  }

  // For sources without a table (e.g. metric sources), return early
  if (!source.from.tableName) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              source: meta,
              nextSteps: {
                query: `Use hyperdx_timeseries, hyperdx_table, or hyperdx_search with sourceId "${sourceId}" and the metric tables above.`,
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
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Connection not found for source "${sourceId}".`,
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
  const { databaseName, tableName } = source.from;
  const connectionId = source.connection.toString();

  // Track which sampling stages were skipped due to timeout
  const skippedStages: string[] = [];

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

  const metadataMVs =
    'metadataMaterializedViews' in source
      ? source.metadataMaterializedViews
      : undefined;

  const now = new Date();
  const dateRange: [Date, Date] = [
    new Date(now.getTime() - VALUE_SAMPLE_LOOKBACK_MS),
    now,
  ];

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
        signal,
      });
      for (const { key, value } of results) {
        if (value.length > 0) {
          lowCardinalityValues[key] = value;
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
        keyExprs.push(`${colName}['${key}']`);
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
        signal,
      });
      for (const { key, value } of results) {
        if (value.length > 0) {
          mapAttributeValues[key] = value;
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

  // Flag partial results so the LLM knows value samples may be incomplete
  if (skippedStages.length > 0) {
    meta.partial = true;
    meta.skippedStages = skippedStages;
  }

  const lcValuesHint =
    skippedStages.length > 0
      ? 'Value sampling was partially skipped due to timeout. ' +
        'The values shown may be incomplete — verify with a hyperdx_search query if needed.'
      : 'These are the REAL values in your data — use them in filters instead of guessing. ' +
        'Example: where: "SeverityText:error" (if \'error\' appears in the sampled values above).';

  const { data: output } = trimToolResponse({
    source: meta,
    usage: {
      topLevelColumns:
        'Use directly in valueExpression/groupBy with PascalCase: Duration, StatusCode, SpanName',
      mapAttributes:
        "Use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']",
      lowCardinalityValues: lcValuesHint,
    },
    nextSteps: {
      query: `Use hyperdx_timeseries, hyperdx_table, or hyperdx_search with sourceId "${sourceId}" and the columns/attributes above.`,
      mapAttributeAccess:
        "Use bracket syntax for map columns: ResourceAttributes['service.name'], SpanAttributes['http.method']",
    },
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(output),
      },
    ],
  };
}

export function registerDescribeSource(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_describe_source',
    {
      title: 'Describe Source Schema',
      description:
        'CALL THIS BEFORE WRITING QUERIES — prevents unknown-column errors.\n\n' +
        'Returns the full column schema, map-attribute keys, and sampled low-cardinality ' +
        'values (e.g. SeverityText, StatusCode, ServiceName) for a single data source.\n\n' +
        'Workflow: call hyperdx_list_sources first to get source IDs, then call this tool ' +
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
            'The source ID to describe. Get this from hyperdx_list_sources.',
          ),
      }),
    },
    withToolTracing(
      'hyperdx_describe_source',
      context,
      async ({ sourceId }) => {
        const controller = new AbortController();

        // Promise.race enforces wall-clock timeout regardless of whether
        // internal ClickHouse calls honour the AbortSignal.
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            controller.abort();
            reject(new Error('DESCRIBE_TIMEOUT'));
          }, DESCRIBE_TIMEOUT_MS);
        });

        try {
          return await Promise.race([
            describeSourceSchema(
              teamId.toString(),
              sourceId,
              controller.signal,
            ),
            timeoutPromise,
          ]);
        } catch (e) {
          if (e instanceof Error && e.message === 'DESCRIBE_TIMEOUT') {
            logger.warn(
              { teamId, sourceId },
              'hyperdx_describe_source timed out',
            );
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text:
                    'Schema discovery timed out. The ClickHouse server may be under load. ' +
                    'Try again, or use hyperdx_list_sources for basic source info without schema details.',
                },
              ],
            };
          }
          logger.warn(
            { teamId, sourceId, error: e },
            'Failed to describe source schema',
          );
          throw e;
        }
      },
    ),
  );
}
