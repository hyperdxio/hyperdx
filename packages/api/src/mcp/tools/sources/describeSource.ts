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
        // Hard timeout for the entire operation
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          DESCRIBE_TIMEOUT_MS,
        );

        try {
          const source = await getSource(teamId.toString(), sourceId);
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
                        query: `Use hyperdx_query with sourceId "${sourceId}" and the metric tables above.`,
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
            teamId.toString(),
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

          // ── 1. Column schema ──────────────────────────────────────────────
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

          // ── 2. Map attribute keys ─────────────────────────────────────────
          const mapColumns = filterColumnMetaByType(columns, [JSDataType.Map]);
          const mapKeysResults: Record<string, string[]> = {};
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
          if (Object.keys(mapKeysResults).length > 0) {
            meta.mapAttributeKeys = mapKeysResults;
          }

          // ── 3. Low-cardinality column value sampling ──────────────────────
          // Identify LowCardinality(String) columns for value sampling
          const lcColumns = columns.filter(c => {
            const normalized = c.type.replace(/\s/g, '');
            return (
              normalized.startsWith('LowCardinality(') &&
              (normalized.includes('String') || normalized.includes('string'))
            );
          });

          const lowCardinalityValues: Record<string, string[]> = {};

          // Check if rollup tables are available for fast value lookups
          const metadataMVs =
            'metadataMaterializedViews' in source
              ? source.metadataMaterializedViews
              : undefined;

          const now = new Date();
          const dateRange: [Date, Date] = [
            new Date(now.getTime() - VALUE_SAMPLE_LOOKBACK_MS),
            now,
          ];

          if (lcColumns.length > 0) {
            // getAllKeyValues uses the rollup table when metadataMVs + dateRange
            // are provided, and falls back to getMapValues otherwise.
            await Promise.all(
              lcColumns.map(async col => {
                try {
                  const values = await metadata.getAllKeyValues({
                    databaseName,
                    tableName,
                    keyExpression: col.name,
                    maxValues: MAX_LC_VALUES,
                    connectionId,
                    metadataMVs,
                    dateRange,
                    signal: controller.signal,
                  });
                  if (values.length > 0) {
                    lowCardinalityValues[col.name] = values;
                  }
                } catch {
                  // Skip columns where value sampling fails
                }
              }),
            );
          }

          if (Object.keys(lowCardinalityValues).length > 0) {
            meta.lowCardinalityValues = lowCardinalityValues;
          }

          // ── 4. Map attribute value sampling (best-effort) ─────────────────
          // Sample values for the top N most common map attribute keys
          if (
            Object.keys(mapKeysResults).length > 0 &&
            !controller.signal.aborted
          ) {
            const mapAttributeValues: Record<string, string[]> = {};

            // Build flat list of bracket-notation key expressions for the top
            // keys across all map columns.
            const keyExprs: { expression: string }[] = [];
            for (const [colName, keys] of Object.entries(mapKeysResults)) {
              for (const key of keys.slice(0, MAX_MAP_KEYS_TO_SAMPLE)) {
                keyExprs.push({ expression: `${colName}['${key}']` });
              }
            }

            await Promise.all(
              keyExprs.map(async ({ expression }) => {
                try {
                  const values = await metadata.getAllKeyValues({
                    databaseName,
                    tableName,
                    keyExpression: expression,
                    maxValues: MAX_MAP_KEY_VALUES,
                    connectionId,
                    metadataMVs,
                    dateRange,
                    signal: controller.signal,
                  });
                  if (values.length > 0) {
                    mapAttributeValues[expression] = values;
                  }
                } catch {
                  // Best-effort; skip on failure
                }
              }),
            );

            if (Object.keys(mapAttributeValues).length > 0) {
              meta.mapAttributeValues = mapAttributeValues;
            }
          }

          const output = trimToolResponse({
            source: meta,
            usage: {
              topLevelColumns:
                'Use directly in valueExpression/groupBy with PascalCase: Duration, StatusCode, SpanName',
              mapAttributes:
                "Use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']",
              lowCardinalityValues:
                'These are the REAL values in your data — use them in filters instead of guessing. ' +
                'Example: where: "SeverityText:error" (if \'error\' appears in the sampled values above).',
            },
            nextSteps: {
              query: `Use hyperdx_query with sourceId "${sourceId}" and the columns/attributes above.`,
              mapAttributeAccess:
                "Use bracket syntax for map columns: ResourceAttributes['service.name'], SpanAttributes['http.method']",
            },
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(output, null, 2),
              },
            ],
          };
        } catch (e) {
          // Return a structured error instead of letting AbortError or
          // ClickHouse failures propagate as opaque server errors.
          if (e instanceof Error && e.name === 'AbortError') {
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
        } finally {
          clearTimeout(timeout);
        }
      },
    ),
  );
}
