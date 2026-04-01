import {
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import { uniq } from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod/v4';

import * as config from '@/config';
import { deleteDashboardAlerts } from '@/controllers/alerts';
import {
  getConnectionById,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { deleteDashboard, getDashboards } from '@/controllers/dashboard';
import { getSources } from '@/controllers/sources';
import Dashboard from '@/models/dashboard';
import {
  createDashboardBodySchema,
  getMissingConnections,
  getMissingSources,
  resolveSavedQueryLanguage,
  updateDashboardBodySchema,
} from '@/routers/external-api/v2/utils/dashboards';
import {
  convertToExternalDashboard,
  convertToInternalTileConfig,
  isConfigTile,
  type SeriesTile,
} from '@/routers/external-api/v2/utils/dashboards';
import {
  translateExternalChartToTileConfig,
  translateExternalFilterToFilter,
} from '@/utils/externalApi';
import logger from '@/utils/logger';
import type {
  ExternalDashboardFilterWithId,
  ExternalDashboardTileWithId,
} from '@/utils/zod';

import { withToolTracing } from '../utils/tracing';
import { parseTimeRange, runConfigTile } from './query';
import { ToolDefinition } from './types';

// ─── Typed tile schemas for MCP tools ───────────────────────────────────────

const mcpTileSelectItemSchema = z.object({
  aggFn: z
    .enum([
      'avg',
      'count',
      'count_distinct',
      'last_value',
      'max',
      'min',
      'quantile',
      'sum',
      'none',
    ])
    .describe(
      'Aggregation function. "count" requires no valueExpression; all others do.',
    ),
  valueExpression: z
    .string()
    .optional()
    .describe(
      'Column or expression to aggregate. Required for all aggFn except "count". ' +
        'Use PascalCase for top-level columns (e.g. "Duration", "StatusCode"). ' +
        "For span attributes use: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "For resource attributes use: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe('Filter in Lucene syntax. Example: "level:error"'),
  whereLanguage: z.enum(['lucene', 'sql']).optional().default('lucene'),
  alias: z.string().optional().describe('Display label for this series'),
  level: z
    .union([z.literal(0.5), z.literal(0.9), z.literal(0.95), z.literal(0.99)])
    .optional()
    .describe('Percentile level for aggFn="quantile"'),
});

const mcpTileLayoutSchema = z.object({
  name: z.string().describe('Tile title shown on the dashboard'),
  x: z
    .number()
    .min(0)
    .max(23)
    .optional()
    .default(0)
    .describe('Horizontal grid position (0–23). Default 0'),
  y: z
    .number()
    .min(0)
    .optional()
    .default(0)
    .describe('Vertical grid position. Default 0'),
  w: z
    .number()
    .min(1)
    .max(24)
    .optional()
    .default(12)
    .describe('Width in grid columns (1–24). Default 12'),
  h: z
    .number()
    .min(1)
    .optional()
    .default(4)
    .describe('Height in grid rows. Default 4'),
  id: z
    .string()
    .max(36)
    .optional()
    .describe('Tile ID (auto-generated if omitted)'),
});

const mcpLineTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('line').describe('Line chart over time'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z
      .array(mcpTileSelectItemSchema)
      .min(1)
      .max(20)
      .describe('Metrics to plot (one series per item)'),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Column to split/group by. ' +
          'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
          "Span attributes: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
          "Resource attributes: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
      ),
    fillNulls: z.boolean().optional().default(true),
    alignDateRangeToGranularity: z.boolean().optional(),
    asRatio: z
      .boolean()
      .optional()
      .describe(
        'Plot as ratio of two metrics (requires exactly 2 select items)',
      ),
  }),
});

const mcpBarTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z
      .literal('stacked_bar')
      .describe('Stacked bar chart over time'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z.array(mcpTileSelectItemSchema).min(1).max(20),
    groupBy: z.string().optional(),
    fillNulls: z.boolean().optional().default(true),
    alignDateRangeToGranularity: z.boolean().optional(),
    asRatio: z.boolean().optional(),
  }),
});

const mcpTableTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('table').describe('Tabular aggregated data'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z.array(mcpTileSelectItemSchema).min(1).max(20),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Group rows by this column. Use PascalCase for top-level columns (e.g. "SpanName"). ' +
          "For attributes: SpanAttributes['key'] or ResourceAttributes['key'].",
      ),
    orderBy: z.string().optional().describe('Sort results by this column'),
    asRatio: z.boolean().optional(),
  }),
});

const mcpNumberTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('number').describe('Single aggregate scalar value'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z
      .array(mcpTileSelectItemSchema)
      .length(1)
      .describe('Exactly one metric to display'),
  }),
});

const mcpPieTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('pie').describe('Pie chart'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    select: z.array(mcpTileSelectItemSchema).length(1),
    groupBy: z
      .string()
      .optional()
      .describe(
        'Column that defines pie slices. Use PascalCase for top-level columns. ' +
          "For attributes: SpanAttributes['key'] or ResourceAttributes['key'].",
      ),
  }),
});

const mcpSearchTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('search').describe('Log/event search results list'),
    sourceId: z.string().describe('Source ID – call hyperdx_list_sources'),
    where: z
      .string()
      .optional()
      .default('')
      .describe('Filter in Lucene syntax. Example: "level:error"'),
    whereLanguage: z.enum(['lucene', 'sql']).optional().default('lucene'),
    select: z
      .string()
      .optional()
      .default('')
      .describe(
        'Columns to display (empty = defaults). Example: "body,service.name,duration"',
      ),
  }),
});

const mcpMarkdownTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    displayType: z.literal('markdown').describe('Free-form Markdown text tile'),
    markdown: z.string().optional().default(''),
  }),
});

const mcpSqlTileSchema = mcpTileLayoutSchema.extend({
  config: z.object({
    configType: z
      .literal('sql')
      .describe(
        'Must be "sql" for raw SQL tiles. ' +
          'ADVANCED: Only use raw SQL tiles when the builder tile types cannot express the query you need.',
      ),
    displayType: z
      .enum(['line', 'stacked_bar', 'table', 'number', 'pie'])
      .describe('How to render the SQL results'),
    connectionId: z
      .string()
      .describe(
        'Connection ID (not sourceId) – call hyperdx_list_sources to find available connections',
      ),
    sqlTemplate: z
      .string()
      .describe(
        'Raw ClickHouse SQL query. Always include a LIMIT clause to avoid excessive data.\n' +
          'Use query parameters: {startDateMilliseconds:Int64}, {endDateMilliseconds:Int64}, ' +
          '{intervalSeconds:Int64}, {intervalMilliseconds:Int64}.\n' +
          'Or use macros: $__timeFilter(col), $__timeFilter_ms(col), $__dateFilter(col), ' +
          '$__fromTime, $__toTime, $__fromTime_ms, $__toTime_ms, ' +
          '$__timeInterval(col), $__timeInterval_ms(col), $__interval_s, $__filters.\n' +
          'Example: "SELECT $__timeInterval(TimestampTime) AS ts, ServiceName, count() ' +
          'FROM otel_logs WHERE $__timeFilter(TimestampTime) AND $__filters ' +
          'GROUP BY ServiceName, ts ORDER BY ts"',
      ),
    fillNulls: z.boolean().optional(),
    alignDateRangeToGranularity: z.boolean().optional(),
  }),
});

const mcpTileSchema = z.union([
  mcpLineTileSchema,
  mcpBarTileSchema,
  mcpTableTileSchema,
  mcpNumberTileSchema,
  mcpPieTileSchema,
  mcpSearchTileSchema,
  mcpMarkdownTileSchema,
  mcpSqlTileSchema,
]);

const mcpTilesParam = z
  .array(mcpTileSchema)
  .describe(
    'Array of dashboard tiles. Each tile needs a name, optional layout (x/y/w/h), and a config block. ' +
      'The config block varies by displayType – use hyperdx_list_sources for sourceId and connectionId values.\n\n' +
      'Example tiles:\n' +
      '1. Line chart: { "name": "Error Rate", "config": { "displayType": "line", "sourceId": "<from list_sources>", ' +
      '"groupBy": "ResourceAttributes[\'service.name\']", "select": [{ "aggFn": "count", "where": "StatusCode:STATUS_CODE_ERROR" }] } }\n' +
      '2. Table: { "name": "Top Endpoints", "config": { "displayType": "table", "sourceId": "<from list_sources>", ' +
      '"groupBy": "SpanAttributes[\'http.route\']", "select": [{ "aggFn": "count" }, { "aggFn": "avg", "valueExpression": "Duration" }] } }\n' +
      '3. Number: { "name": "Total Requests", "config": { "displayType": "number", "sourceId": "<from list_sources>", ' +
      '"select": [{ "aggFn": "count" }] } }',
  );

// ─── Tool registrations ──────────────────────────────────────────────────────

const dashboardsTools: ToolDefinition = (server, context) => {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  // ── hyperdx_list_sources ──────────────────────────────────────────────────

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

          // Include attribute column info based on source kind
          if ('eventAttributesExpression' in s && s.eventAttributesExpression) {
            meta.eventAttributesColumn = s.eventAttributesExpression;
          }
          if (
            'resourceAttributesExpression' in s &&
            s.resourceAttributesExpression
          ) {
            meta.resourceAttributesColumn = s.resourceAttributesExpression;
          }

          // Include kind-specific useful expressions
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

          // Fetch column schema and map attribute keys
          try {
            const connection = await getConnectionById(
              teamId.toString(),
              s.connection.toString(),
              true, // decrypt password
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

            // Sample keys from map columns (e.g. SpanAttributes, ResourceAttributes)
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

  // ── hyperdx_get_dashboard ─────────────────────────────────────────────────

  server.registerTool(
    'hyperdx_get_dashboard',
    {
      title: 'Get Dashboard(s)',
      description:
        'Without an ID: list all dashboards (returns IDs, names, tags). ' +
        'With an ID: get full dashboard detail including all tiles and configuration.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Dashboard ID. Omit to list all dashboards, provide to get full detail.',
          ),
      }),
    },
    withToolTracing('hyperdx_get_dashboard', context, async ({ id }) => {
      if (!id) {
        const dashboards = await getDashboards(
          new mongoose.Types.ObjectId(teamId),
        );
        const output = dashboards.map(d => ({
          id: d._id.toString(),
          name: d.name,
          tags: d.tags,
          ...(frontendUrl ? { url: `${frontendUrl}/dashboards/${d._id}` } : {}),
        }));
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      const dashboard = await Dashboard.findOne({ _id: id, team: teamId });
      if (!dashboard) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Dashboard not found' }],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...convertToExternalDashboard(dashboard),
                ...(frontendUrl
                  ? { url: `${frontendUrl}/dashboards/${dashboard._id}` }
                  : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // ── hyperdx_save_dashboard ────────────────────────────────────────────────

  server.registerTool(
    'hyperdx_save_dashboard',
    {
      title: 'Create or Update Dashboard',
      description:
        'Create a new dashboard (omit id) or update an existing one (provide id). ' +
        'Call hyperdx_list_sources first to obtain sourceId and connectionId values. ' +
        'IMPORTANT: After saving a dashboard, always run hyperdx_query_tile on each tile ' +
        'to confirm the queries work and return expected data. Tiles can silently fail ' +
        'due to incorrect filter syntax, missing attributes, or wrong column names.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Dashboard ID. Omit to create a new dashboard, provide to update an existing one.',
          ),
        name: z.string().describe('Dashboard name'),
        tiles: mcpTilesParam,
        tags: z.array(z.string()).optional().describe('Dashboard tags'),
      }),
    },
    withToolTracing(
      'hyperdx_save_dashboard',
      context,
      async ({ id: dashboardId, name, tiles: inputTiles, tags }) => {
        if (!dashboardId) {
          // ── CREATE ──────────────────────────────────────────────────────────
          const parsed = createDashboardBodySchema.safeParse({
            name,
            tiles: inputTiles,
            tags,
          });
          if (!parsed.success) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Validation error: ${JSON.stringify(parsed.error.errors)}`,
                },
              ],
            };
          }

          const { tiles, filters } = parsed.data;
          const tilesWithId = tiles as ExternalDashboardTileWithId[];

          const [missingSources, missingConnections] = await Promise.all([
            getMissingSources(teamId, tilesWithId, filters),
            getMissingConnections(teamId, tilesWithId),
          ]);
          if (missingSources.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Could not find source IDs: ${missingSources.join(', ')}`,
                },
              ],
            };
          }
          if (missingConnections.length > 0) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Could not find connection IDs: ${missingConnections.join(', ')}`,
                },
              ],
            };
          }

          const internalTiles = tilesWithId.map(tile => {
            const tileId = new mongoose.Types.ObjectId().toString();
            if (isConfigTile(tile)) {
              return convertToInternalTileConfig({ ...tile, id: tileId });
            }
            return translateExternalChartToTileConfig({
              ...tile,
              id: tileId,
            } as SeriesTile);
          });

          const filtersWithIds = (filters ?? []).map(filter =>
            translateExternalFilterToFilter({
              ...filter,
              id: new mongoose.Types.ObjectId().toString(),
            }),
          );

          const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
            savedQuery: undefined,
            savedQueryLanguage: undefined,
          });

          const newDashboard = await new Dashboard({
            name: parsed.data.name,
            tiles: internalTiles,
            tags: tags && uniq(tags),
            filters: filtersWithIds,
            savedQueryLanguage: normalizedSavedQueryLanguage,
            savedFilterValues: parsed.data.savedFilterValues,
            team: teamId,
          }).save();

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    ...convertToExternalDashboard(newDashboard),
                    ...(frontendUrl
                      ? {
                          url: `${frontendUrl}/dashboards/${newDashboard._id}`,
                        }
                      : {}),
                    hint: 'Use hyperdx_query to test individual tile queries before viewing the dashboard.',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ── UPDATE ──────────────────────────────────────────────────────────
        const parsed = updateDashboardBodySchema.safeParse({
          name,
          tiles: inputTiles,
          tags,
        });
        if (!parsed.success) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Validation error: ${JSON.stringify(parsed.error.errors)}`,
              },
            ],
          };
        }

        const { tiles, filters } = parsed.data;
        const tilesWithId = tiles as ExternalDashboardTileWithId[];

        const [missingSources, missingConnections] = await Promise.all([
          getMissingSources(teamId, tilesWithId, filters),
          getMissingConnections(teamId, tilesWithId),
        ]);
        if (missingSources.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Could not find source IDs: ${missingSources.join(', ')}`,
              },
            ],
          };
        }
        if (missingConnections.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Could not find connection IDs: ${missingConnections.join(', ')}`,
              },
            ],
          };
        }

        const existingDashboard = await Dashboard.findOne(
          { _id: dashboardId, team: teamId },
          { tiles: 1, filters: 1 },
        ).lean();

        if (!existingDashboard) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        const existingTileIds = new Set(
          (existingDashboard.tiles ?? []).map((t: { id: string }) => t.id),
        );
        const existingFilterIds = new Set(
          (existingDashboard.filters ?? []).map((f: { id: string }) => f.id),
        );

        const internalTiles = tilesWithId.map(tile => {
          const tileId =
            tile.id && existingTileIds.has(tile.id)
              ? tile.id
              : new mongoose.Types.ObjectId().toString();
          if (isConfigTile(tile)) {
            return convertToInternalTileConfig({ ...tile, id: tileId });
          }
          return translateExternalChartToTileConfig({
            ...tile,
            id: tileId,
          } as SeriesTile);
        });

        const setPayload: Record<string, unknown> = {
          name,
          tiles: internalTiles,
          tags: tags && uniq(tags),
        };

        if (filters !== undefined) {
          setPayload.filters = filters.map(
            (filter: ExternalDashboardFilterWithId) => {
              const filterId = existingFilterIds.has(filter.id)
                ? filter.id
                : new mongoose.Types.ObjectId().toString();
              return translateExternalFilterToFilter({
                ...filter,
                id: filterId,
              });
            },
          );
        }

        const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
          savedQuery: undefined,
          savedQueryLanguage: undefined,
        });
        if (normalizedSavedQueryLanguage !== undefined) {
          setPayload.savedQueryLanguage = normalizedSavedQueryLanguage;
        }

        if (parsed.data.savedFilterValues !== undefined) {
          setPayload.savedFilterValues = parsed.data.savedFilterValues;
        }

        const updatedDashboard = await Dashboard.findOneAndUpdate(
          { _id: dashboardId, team: teamId },
          { $set: setPayload },
          { new: true },
        );

        if (!updatedDashboard) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        // Delete alerts for raw SQL tiles (unsupported) or removed tiles
        const newTileIdSet = new Set(internalTiles.map(t => t.id));
        const tileIdsToDeleteAlerts = [
          ...internalTiles
            .filter(tile => isRawSqlSavedChartConfig(tile.config))
            .map(tile => tile.id),
          ...[...existingTileIds].filter(id => !newTileIdSet.has(id)),
        ];
        if (tileIdsToDeleteAlerts.length > 0) {
          logger.info(
            { dashboardId, teamId, tileIds: tileIdsToDeleteAlerts },
            'Deleting alerts for tiles with unsupported config or removed tiles',
          );
          await deleteDashboardAlerts(
            dashboardId,
            new mongoose.Types.ObjectId(teamId),
            tileIdsToDeleteAlerts,
          );
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...convertToExternalDashboard(updatedDashboard),
                  ...(frontendUrl
                    ? {
                        url: `${frontendUrl}/dashboards/${updatedDashboard._id}`,
                      }
                    : {}),
                  hint: 'Use hyperdx_query to test individual tile queries before viewing the dashboard.',
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );

  // ── hyperdx_delete_dashboard ──────────────────────────────────────────────

  server.registerTool(
    'hyperdx_delete_dashboard',
    {
      title: 'Delete Dashboard',
      description:
        'Permanently delete a dashboard by ID. Also removes any alerts attached to its tiles. ' +
        'Use hyperdx_get_dashboard (without an ID) to list available dashboard IDs.',
      inputSchema: z.object({
        id: z.string().describe('Dashboard ID to delete.'),
      }),
    },
    withToolTracing(
      'hyperdx_delete_dashboard',
      context,
      async ({ id: dashboardId }) => {
        const existing = await Dashboard.findOne({
          _id: dashboardId,
          team: teamId,
        }).lean();
        if (!existing) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        await deleteDashboard(dashboardId, new mongoose.Types.ObjectId(teamId));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ deleted: true, id: dashboardId }, null, 2),
            },
          ],
        };
      },
    ),
  );

  // ── hyperdx_query_tile ────────────────────────────────────────────────────

  server.registerTool(
    'hyperdx_query_tile',
    {
      title: 'Query a Dashboard Tile',
      description:
        'Execute the query for a specific tile on an existing dashboard. ' +
        'Useful for validating that a tile returns data or for spot-checking results ' +
        'without rebuilding the query from scratch. ' +
        'Use hyperdx_get_dashboard with an ID to find tile IDs.',
      inputSchema: z.object({
        dashboardId: z.string().describe('Dashboard ID.'),
        tileId: z
          .string()
          .describe(
            'Tile ID within the dashboard. ' +
              'Obtain from hyperdx_get_dashboard.',
          ),
        startTime: z
          .string()
          .optional()
          .describe(
            'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
              'If results are empty, try a wider range (e.g. 24 hours).',
          ),
        endTime: z
          .string()
          .optional()
          .describe('End of the query window as ISO 8601. Default: now.'),
      }),
    },
    withToolTracing(
      'hyperdx_query_tile',
      context,
      async ({ dashboardId, tileId, startTime, endTime }) => {
        const timeRange = parseTimeRange(startTime, endTime);
        if ('error' in timeRange) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: timeRange.error }],
          };
        }
        const { startDate, endDate } = timeRange;

        const dashboard = await Dashboard.findOne({
          _id: dashboardId,
          team: teamId,
        });
        if (!dashboard) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Dashboard not found' }],
          };
        }

        const externalDashboard = convertToExternalDashboard(dashboard);
        const tile = externalDashboard.tiles.find(t => t.id === tileId);
        if (!tile) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Tile not found: ${tileId}. Available tile IDs: ${externalDashboard.tiles.map(t => t.id).join(', ')}`,
              },
            ],
          };
        }

        return runConfigTile(
          teamId.toString(),
          tile as ExternalDashboardTileWithId,
          startDate,
          endDate,
        );
      },
    ),
  );
};

export default dashboardsTools;
