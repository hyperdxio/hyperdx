import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
} from '@/fixtures';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import { Source } from '@/models/source';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_query_tile', () => {
  const ctx = setupDashboardTests();

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: '000000000000000000000000',
      tileId: 'some-tile-id',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('should return error for non-existent tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Tile Query Test',
        tiles: [
          {
            name: 'My Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: 'non-existent-tile-id',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Tile not found');
  });

  it('should return error for invalid time range', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Time Range Test',
        tiles: [
          {
            name: 'Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: 'not-a-date',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Invalid');
  });

  it('should execute query for a valid tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Query Tile Test',
        tiles: [
          {
            name: 'Count Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
    });

    // Should succeed (may have empty results since no data inserted)
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
  });

  describe('raw SQL macro warnings', () => {
    it('attaches a non-blocking warning when a raw SQL tile omits macros', async () => {
      const connectionId = ctx.connection._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Query macro-less SQL tile',
          tiles: [
            {
              name: 'Static SQL',
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId,
                // Runs fine against ClickHouse but uses no time-range /
                // filter / source macros.
                sqlTemplate: 'SELECT 1 AS value LIMIT 1',
              },
            },
          ],
        },
      );
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      // Non-blocking: the query still executes and returns its row.
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getFirstText(result));
      expect(parsed.result).toBeDefined();

      // The advisory rides alongside the result.
      expect(Array.isArray(parsed.warnings)).toBe(true);
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain('Static SQL');
      expect(parsed.warnings[0]).toContain('$__timeFilter');
      expect(parsed.warnings[0]).toContain('strongly recommended');
    });

    it('does not attach warnings when a raw SQL tile uses all recommended macros', async () => {
      const connectionId = ctx.connection._id.toString();
      const sourceId = ctx.traceSource._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Query macro SQL tile',
          tiles: [
            {
              name: 'Macro SQL',
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId,
                sourceId,
                sqlTemplate:
                  'SELECT ServiceName, count() AS c FROM $__sourceTable ' +
                  'WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName LIMIT 10',
              },
            },
          ],
        },
      );
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getFirstText(result));
      expect(parsed.warnings).toBeUndefined();
    });
  });

  describe('categorical (bar) tile series limit', () => {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // Five distinct services with descending row counts, so a limit keeps a
    // strict, deterministic top-N subset.
    const SERVICE_COUNTS: [string, number][] = [
      ['svc-a', 5],
      ['svc-b', 4],
      ['svc-c', 3],
      ['svc-d', 2],
      ['svc-e', 1],
    ];

    let logSourceId: string;

    beforeEach(async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: ctx.team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        connection: ctx.connection._id,
        name: 'Bar Limit Logs',
        bodyExpression: 'Body',
        severityTextExpression: 'SeverityText',
      });
      logSourceId = logSource._id.toString();

      const logs: Parameters<typeof bulkInsertLogs>[0] = [];
      SERVICE_COUNTS.forEach(([serviceName, count], svcIdx) => {
        for (let i = 0; i < count; i++) {
          logs.push({
            Body: `bar limit log ${serviceName} ${i}`,
            ServiceName: serviceName,
            SeverityText: 'INFO',
            Timestamp: new Date(tenMinAgo.getTime() + (svcIdx * 100 + i) * 10),
          });
        }
      });
      await bulkInsertLogs(logs);
    });

    const saveBarDashboard = async (limit?: number) => {
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: `Bar Limit Dashboard ${limit ?? 'none'}`,
          tiles: [
            {
              name: 'Bars by service',
              config: {
                displayType: 'bar',
                sourceId: logSourceId,
                select: [{ aggFn: 'count' }],
                groupBy: 'ServiceName',
                ...(limit != null ? { limit } : {}),
              },
            },
          ],
        },
      );
      expect(createResult.isError).toBeFalsy();
      return JSON.parse(getFirstText(createResult));
    };

    const queryTileRows = async (dashboard: any) => {
      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getFirstText(result));
      return parsed.result.data as Record<string, string>[];
    };

    it('returns every group when no limit is set', async () => {
      const dashboard = await saveBarDashboard();
      const rows = await queryTileRows(dashboard);
      expect(rows).toHaveLength(SERVICE_COUNTS.length);
    });

    it('caps the bars to the series limit, keeping the largest groups', async () => {
      const dashboard = await saveBarDashboard(3);
      const rows = await queryTileRows(dashboard);

      // The limit must actually reduce the result below the full set.
      expect(rows).toHaveLength(3);
      expect(rows.length).toBeLessThan(SERVICE_COUNTS.length);

      // And it must keep the top-3 by count, not an arbitrary subset.
      const services = rows.map(r => r.ServiceName).sort();
      expect(services).toEqual(['svc-a', 'svc-b', 'svc-c']);
    });
  });
});
