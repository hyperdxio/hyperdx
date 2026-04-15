import { ObjectId } from 'mongodb';

import type { ExternalDashboardTileWithId } from '@/utils/zod';
import { externalDashboardTileSchemaWithId } from '@/utils/zod';

import { withToolTracing } from '../../utils/tracing';
import type { ToolDefinition } from '../types';
import { parseTimeRange, runConfigTile } from './helpers';
import { hyperdxQuerySchema, validateQueryInput } from './schemas';

// ─── Tool definition ─────────────────────────────────────────────────────────

const queryTools: ToolDefinition = (server, context) => {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_query',
    {
      title: 'Query Data',
      description:
        'Query observability data (logs, metrics, traces) from HyperDX. ' +
        'Use hyperdx_list_sources first to find sourceId/connectionId values. ' +
        'Set displayType to control the query shape.\n\n' +
        'PREFERRED: Use the builder display types (line, stacked_bar, table, number, pie) ' +
        'for aggregated metrics, or "search" for browsing individual log/event rows. ' +
        'These are safer, easier to construct, and cover most use cases.\n\n' +
        'ADVANCED: Use displayType "sql" only when you need capabilities the builder cannot express, ' +
        'such as JOINs, sub-queries, CTEs, or querying tables not registered as sources. ' +
        'Raw SQL requires a connectionId (not sourceId) and a hand-written ClickHouse SQL query.\n\n' +
        'Column naming: Top-level columns are PascalCase (Duration, StatusCode, SpanName). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']. " +
        'Call hyperdx_list_sources to discover available columns and attribute keys for each source.',
      inputSchema: hyperdxQuerySchema,
    },
    withToolTracing('hyperdx_query', context, async input => {
      // Cross-field validation (kept out of the Zod schema to avoid
      // .superRefine() wrapping in ZodEffects, which the MCP SDK's
      // normalizeObjectSchema() cannot serialize to JSON Schema).
      const validationError = validateQueryInput(input);
      if (validationError) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: validationError }],
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

      let tile: ExternalDashboardTileWithId;

      if (input.displayType === 'sql') {
        tile = externalDashboardTileSchemaWithId.parse({
          id: new ObjectId().toString(),
          name: 'MCP SQL',
          x: 0,
          y: 0,
          w: 24,
          h: 6,
          config: {
            configType: 'sql' as const,
            displayType: 'table' as const,
            connectionId: input.connectionId,
            sqlTemplate: input.sql,
          },
        });
      } else if (input.displayType === 'search') {
        tile = externalDashboardTileSchemaWithId.parse({
          id: new ObjectId().toString(),
          name: 'MCP Search',
          x: 0,
          y: 0,
          w: 24,
          h: 6,
          config: {
            displayType: 'search' as const,
            sourceId: input.sourceId,
            select: input.columns ?? '',
            where: input.where ?? '',
            whereLanguage: input.whereLanguage ?? 'lucene',
          },
        });
      } else {
        tile = externalDashboardTileSchemaWithId.parse({
          id: new ObjectId().toString(),
          name: 'MCP Query',
          x: 0,
          y: 0,
          w: 12,
          h: 4,
          config: {
            displayType: input.displayType,
            sourceId: input.sourceId,
            select: input.select!.map(s => ({
              aggFn: s.aggFn,
              where: s.where ?? '',
              whereLanguage: s.whereLanguage ?? 'lucene',
              valueExpression: s.valueExpression,
              alias: s.alias,
              level: s.level,
            })),
            groupBy: input.groupBy ?? undefined,
            orderBy: input.orderBy ?? undefined,
            ...(input.granularity ? { granularity: input.granularity } : {}),
          },
        });
      }

      return runConfigTile(
        teamId.toString(),
        tile,
        startDate,
        endDate,
        input.displayType === 'search'
          ? { maxResults: input.maxResults }
          : undefined,
      );
    }),
  );
};

export default queryTools;
