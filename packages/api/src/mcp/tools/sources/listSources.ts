import { SourceKind } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getConnectionsByTeam } from '@/controllers/connection';
import { getSources } from '@/controllers/sources';
import type { McpContext } from '@/mcp/tools/types';
import { withToolTracing } from '@/mcp/utils/tracing';

import { sanitizeMetricTables } from './metricKinds';

export function registerListSources(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'clickstack_list_sources',
    {
      title: 'List Sources & Connections',
      description:
        'List all data sources (logs, metrics, traces) and database connections available to this team. ' +
        'Returns source IDs, names, kinds, and connection IDs as a lightweight catalog.\n\n' +
        'NEXT STEP: After identifying the source(s) you need, call clickstack_describe_source with the ' +
        'sourceId to get the full column schema, attribute keys, and sampled values. ' +
        'This two-step approach avoids fetching expensive schema details for sources you do not need.\n\n' +
        'NOTE: For most queries, use source IDs with clickstack_timeseries, clickstack_table, ' +
        'clickstack_search, or clickstack_event_patterns. ' +
        'Connection IDs are only needed for clickstack_sql (raw ClickHouse SQL).',
      inputSchema: z.object({}),
    },
    withToolTracing('clickstack_list_sources', context, async () => {
      const [sources, connections] = await Promise.all([
        getSources(teamId.toString()),
        getConnectionsByTeam(teamId.toString()),
      ]);

      const sourceSummaries = sources.map(s => {
        const meta: Record<string, unknown> = {
          id: s._id.toString(),
          name: s.name,
          kind: s.kind,
          connectionId: s.connection.toString(),
          timestampColumn: s.timestampValueExpression,
        };

        if ('eventAttributesExpression' in s && s.eventAttributesExpression) {
          meta.eventAttributesColumn = s.eventAttributesExpression;
        }
        if (
          'resourceAttributesExpression' in s &&
          s.resourceAttributesExpression
        ) {
          meta.resourceAttributesColumn = s.resourceAttributesExpression;
        }

        if (s.kind === SourceKind.Trace) {
          meta.keyColumns = {
            spanName: s.spanNameExpression,
            duration: s.durationExpression,
            durationPrecision: s.durationPrecision,
            statusCode: s.statusCodeExpression,
            serviceName: s.serviceNameExpression,
            traceId: s.traceIdExpression,
            spanId: s.spanIdExpression,
          };
        } else if (s.kind === SourceKind.Log) {
          meta.keyColumns = {
            body: s.bodyExpression,
            serviceName: s.serviceNameExpression,
            severityText: s.severityTextExpression,
            traceId: s.traceIdExpression,
          };
        } else if (s.kind === SourceKind.Metric) {
          // Filter out implementation-detail keys (e.g. a stray Mongoose
          // `_id` on the metricTables subdoc) so the agent only sees
          // valid metric kinds.
          const tables = sanitizeMetricTables(
            s.metricTables as Record<string, unknown> | undefined,
          );
          if (tables) meta.metricTables = tables;
        }

        return meta;
      });

      const output = {
        sources: sourceSummaries,
        connections: connections.map(c => ({
          id: c._id.toString(),
          name: c.name,
        })),
        nextStep:
          'Call clickstack_describe_source with a sourceId above to get the full column schema, ' +
          'attribute keys, and sampled low-cardinality values before writing queries. ' +
          'connectionId is only needed for clickstack_sql.',
      };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    }),
  );
}
