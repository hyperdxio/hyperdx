import {
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  getConnectionById,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { getSources } from '@/controllers/sources';
import logger from '@/utils/logger';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';

export function registerListSources(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_list_sources',
    {
      title: 'List Sources & Connections',
      description:
        'List all data sources (logs, metrics, traces) and database connections available to this team. ' +
        'Returns source IDs (use as sourceId in hyperdx_query and dashboard tiles) and ' +
        'connection IDs (use as connectionId for advanced raw SQL queries). ' +
        'Each source includes its full column schema and sampled attribute keys from map columns ' +
        '(e.g. SpanAttributes, ResourceAttributes). ' +
        'Column names are PascalCase (e.g. Duration, not duration). ' +
        "Map attributes must be accessed via bracket syntax: SpanAttributes['key'].\n\n" +
        'NOTE: For most queries, use source IDs with the builder display types. ' +
        'Connection IDs are only needed for advanced raw SQL queries (displayType "sql").',
      inputSchema: z.object({}),
    },
    withToolTracing('hyperdx_list_sources', context, async () => {
      const [sources, connections] = await Promise.all([
        getSources(teamId.toString()),
        getConnectionsByTeam(teamId.toString()),
      ]);

      const sourcesWithSchema = await Promise.all(
        sources.map(async s => {
          const meta: Record<string, unknown> = {
            id: s._id.toString(),
            name: s.name,
            kind: s.kind,
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

          if (s.kind === 'trace') {
            meta.keyColumns = {
              spanName:
                'spanNameExpression' in s ? s.spanNameExpression : undefined,
              duration:
                'durationExpression' in s ? s.durationExpression : undefined,
              durationPrecision:
                'durationPrecision' in s ? s.durationPrecision : undefined,
              statusCode:
                'statusCodeExpression' in s
                  ? s.statusCodeExpression
                  : undefined,
              serviceName:
                'serviceNameExpression' in s
                  ? s.serviceNameExpression
                  : undefined,
              traceId:
                'traceIdExpression' in s ? s.traceIdExpression : undefined,
              spanId: 'spanIdExpression' in s ? s.spanIdExpression : undefined,
            };
          } else if (s.kind === 'log') {
            meta.keyColumns = {
              body: 'bodyExpression' in s ? s.bodyExpression : undefined,
              serviceName:
                'serviceNameExpression' in s
                  ? s.serviceNameExpression
                  : undefined,
              severityText:
                'severityTextExpression' in s
                  ? s.severityTextExpression
                  : undefined,
              traceId:
                'traceIdExpression' in s ? s.traceIdExpression : undefined,
            };
          }

          try {
            const connection = await getConnectionById(
              teamId.toString(),
              s.connection.toString(),
              true,
            );
            if (!connection) {
              throw new Error(`Connection not found for source ${s._id}`);
            }

            const clickhouseClient = new ClickhouseClient({
              host: connection.host,
              username: connection.username,
              password: connection.password,
            });
            const metadata = getMetadata(clickhouseClient);

            const columns = await metadata.getColumns({
              databaseName: s.from.databaseName,
              tableName: s.from.tableName,
              connectionId: s.connection.toString(),
            });

            meta.columns = columns.map(c => ({
              name: c.name,
              type: c.type,
              jsType: convertCHDataTypeToJSType(c.type),
            }));

            const mapColumns = filterColumnMetaByType(columns, [
              JSDataType.Map,
            ]);
            const mapKeysResults: Record<string, string[]> = {};
            await Promise.all(
              (mapColumns ?? []).map(async col => {
                try {
                  const keys = await metadata.getMapKeys({
                    databaseName: s.from.databaseName,
                    tableName: s.from.tableName,
                    column: col.name,
                    maxKeys: 50,
                    connectionId: s.connection.toString(),
                  });
                  mapKeysResults[col.name] = keys;
                } catch {
                  // Skip columns where key sampling fails
                }
              }),
            );
            if (Object.keys(mapKeysResults).length > 0) {
              meta.mapAttributeKeys = mapKeysResults;
            }
          } catch (e) {
            logger.warn(
              { teamId, sourceId: s._id, error: e },
              'Failed to fetch schema for source',
            );
          }

          return meta;
        }),
      );

      const output = {
        sources: sourcesWithSchema,
        connections: connections.map(c => ({
          id: c._id.toString(),
          name: c.name,
        })),
        usage: {
          topLevelColumns:
            'Use directly in valueExpression/groupBy with PascalCase: Duration, StatusCode, SpanName',
          mapAttributes:
            "Use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']",
          sourceIds:
            'Use sourceId with builder display types (line, stacked_bar, table, number, pie, search) for standard queries',
          connectionIds:
            'ADVANCED: Use connectionId only with raw SQL queries (displayType "sql" or configType "sql"). ' +
            'Raw SQL is for advanced use cases like JOINs, sub-queries, or querying tables not registered as sources.',
        },
      };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    }),
  );
}
