import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { McpContext } from '../tools/types';
import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Event Deltas Tool', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let logSource: any;
  let connection: any;
  let client: Client;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Logs',
      serviceNameExpression: 'ServiceName',
      severityTextExpression: 'SeverityText',
      bodyExpression: 'Body',
      defaultTableSelectExpression:
        'Timestamp, ServiceName, SeverityText, Body',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('schema serialization', () => {
    it('exposes hyperdx_event_deltas via tools/list with target + baseline groups', async () => {
      const { tools } = await client.listTools();
      const t = tools.find(t => t.name === 'hyperdx_event_deltas');
      expect(t).toBeDefined();
      const schema = t!.inputSchema;
      const props = Object.keys(schema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('target');
      expect(props).toContain('baseline');
      expect(props).toContain('topN');
      expect(props).toContain('includeHidden');
      expect(schema.required).toContain('sourceId');
      expect(schema.required).toContain('target');
      expect(schema.required).toContain('baseline');
    });
  });

  describe('validation', () => {
    it('rejects target where endTime <= startTime', async () => {
      const result = await callTool(client, 'hyperdx_event_deltas', {
        sourceId: logSource._id.toString(),
        target: {
          startTime: '2026-05-10T01:00:00Z',
          endTime: '2026-05-10T01:00:00Z',
        },
        baseline: {
          startTime: '2026-05-10T00:00:00Z',
          endTime: '2026-05-10T00:30:00Z',
        },
      });
      expect(result.isError).toBeTruthy();
      expect(getFirstText(result)).toMatch(/endTime must be greater/);
    });
  });

  describe('algorithm against ClickHouse', () => {
    // Capture once so insert timestamps and query windows are consistent.
    let now: number;

    beforeEach(async () => {
      now = Date.now();
      const events: Array<{
        Body: string;
        ServiceName: string;
        SeverityText: string;
        Timestamp: Date;
      }> = [];

      // Baseline window (5–10 min ago): healthy mix — mostly INFO from
      // service-a, a few from service-b. NO ERROR severity, NO failing rows.
      for (let i = 0; i < 200; i++) {
        events.push({
          Body: `request handled ok id=${i}`,
          ServiceName: i % 5 === 0 ? 'service-b' : 'service-a',
          SeverityText: 'INFO',
          Timestamp: new Date(now - 9 * 60_000 + i * 100),
        });
      }

      // Target window (last 5 min): mostly ERROR from service-b.
      // The DELTA between target and baseline should expose:
      //   - SeverityText shifts to ERROR
      //   - ServiceName shifts toward service-b
      for (let i = 0; i < 200; i++) {
        events.push({
          Body: `request failed id=${i}`,
          ServiceName: i % 5 === 0 ? 'service-a' : 'service-b',
          SeverityText: 'ERROR',
          Timestamp: new Date(now - 4 * 60_000 + i * 100),
        });
      }

      await bulkInsertLogs(events);
    });

    it('ranks SeverityText and ServiceName as top differentiating properties', async () => {
      const result = await callTool(client, 'hyperdx_event_deltas', {
        sourceId: logSource._id.toString(),
        target: {
          startTime: new Date(now - 5 * 60_000).toISOString(),
          endTime: new Date(now).toISOString(),
        },
        baseline: {
          startTime: new Date(now - 10 * 60_000).toISOString(),
          endTime: new Date(now - 5 * 60_000).toISOString(),
        },
        sampleSize: 500,
        topN: 10,
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.summary.targetSampleCount).toBeGreaterThan(0);
      expect(output.summary.baselineSampleCount).toBeGreaterThan(0);
      expect(output.properties.length).toBeGreaterThan(0);

      const topKeys = output.properties.map((p: { key: string }) => p.key);
      // The two columns we deliberately shifted between groups must appear
      // near the top of the ranking.
      expect(topKeys).toEqual(
        expect.arrayContaining(['SeverityText', 'ServiceName']),
      );

      const severity = output.properties.find(
        (p: { key: string }) => p.key === 'SeverityText',
      );
      expect(severity).toBeDefined();
      expect(severity.score).toBeGreaterThan(50);
      // The response intentionally omits separate target.topValues /
      // baseline.topValues — topDeltas covers the same data with per-value
      // target%/baseline%/diff%. Confirm the data is still discoverable.
      expect(severity.target).toBeUndefined();
      expect(severity.baseline).toBeUndefined();
      expect(severity.targetCount).toBeGreaterThan(0);
      expect(severity.baselineCount).toBeGreaterThan(0);
      const errorDelta = (
        severity.topDeltas as Array<{
          value: string;
          targetPct: number;
          baselinePct: number;
        }>
      ).find(v => v.value === 'ERROR');
      expect(errorDelta).toBeDefined();
      // Target window planted ERROR, baseline window planted INFO.
      expect(errorDelta!.targetPct).toBeGreaterThan(errorDelta!.baselinePct);
      const infoDelta = (
        severity.topDeltas as Array<{
          value: string;
          targetPct: number;
          baselinePct: number;
        }>
      ).find(v => v.value === 'INFO');
      expect(infoDelta).toBeDefined();
      expect(infoDelta!.baselinePct).toBeGreaterThan(infoDelta!.targetPct);
    });

    it('returns includeHidden:true with a hidden array containing high-cardinality / id fields', async () => {
      const result = await callTool(client, 'hyperdx_event_deltas', {
        sourceId: logSource._id.toString(),
        target: {
          startTime: new Date(now - 5 * 60_000).toISOString(),
          endTime: new Date(now).toISOString(),
        },
        baseline: {
          startTime: new Date(now - 10 * 60_000).toISOString(),
          endTime: new Date(now - 5 * 60_000).toISOString(),
        },
        sampleSize: 500,
        topN: 5,
        includeHidden: true,
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      // The Body column has unique strings per row → high cardinality → hidden.
      expect(output).toHaveProperty('hidden');
      expect(output.hidden.length).toBeGreaterThan(0);
      const bodyEntry = output.hidden.find(
        (p: { key: string }) => p.key === 'Body',
      );
      expect(bodyEntry).toBeDefined();
      expect(bodyEntry.hiddenReason).toBe('high_cardinality');
    });
  });
});
