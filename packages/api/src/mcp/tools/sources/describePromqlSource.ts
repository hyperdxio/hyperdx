import { quoteIdentifierIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';

import { getPromqlLabelCatalog } from '@/controllers/promql';
import type { ToolResult } from '@/mcp/tools/types';
import { PROMQL_QUERY_USAGE, timeSeriesSqlUsage } from '@/mcp/utils/promql';
import logger from '@/utils/logger';

const LABEL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_LABEL_NAMES = 100;
const MAX_METRIC_NAMES = 200;

/**
 * describe_source for a PromQL source: its label names and metric names
 * instead of a column schema, from either a ClickHouse TimeSeries table or a
 * Prometheus-compatible endpoint.
 */
export async function describePromqlSource({
  teamId,
  source,
  meta,
  signal,
}: {
  teamId: string;
  source: Parameters<typeof getPromqlLabelCatalog>[0]['source'];
  meta: Record<string, unknown>;
  signal: AbortSignal;
}): Promise<ToolResult> {
  const endMs = Date.now();
  let output: Record<string, unknown>;
  let sqlUsage: string | undefined;
  try {
    const catalog = await getPromqlLabelCatalog({
      teamId,
      source,
      startMs: endMs - LABEL_LOOKBACK_MS,
      endMs,
      limit: Math.max(MAX_LABEL_NAMES, MAX_METRIC_NAMES),
      signal,
    });
    const truncated =
      catalog.labelNames.length > MAX_LABEL_NAMES ||
      catalog.metricNames.length > MAX_METRIC_NAMES;
    const table =
      catalog.backend === 'clickhouse'
        ? `${quoteIdentifierIfNeeded(source.from.databaseName)}.${quoteIdentifierIfNeeded(source.from.tableName)}`
        : undefined;
    sqlUsage = table && timeSeriesSqlUsage(table);
    output = {
      source: {
        ...meta,
        backend: catalog.backend,
        ...(table ? { table } : {}),
      },
      labelNames: catalog.labelNames.slice(0, MAX_LABEL_NAMES),
      metricNames: catalog.metricNames.slice(0, MAX_METRIC_NAMES),
      ...(truncated
        ? {
            note: `Lists are capped at ${MAX_LABEL_NAMES} label names and ${MAX_METRIC_NAMES} metric names.`,
          }
        : {}),
    };
  } catch (e) {
    logger.warn(
      { teamId, error: e },
      'Failed to list labels for a PromQL source',
    );
    output = {
      source: meta,
      partial: true,
      error: `Could not list labels: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...output,
            nextSteps: {
              query: PROMQL_QUERY_USAGE,
              ...(sqlUsage ? { sql: sqlUsage } : {}),
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}
