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
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Emerging Signals Tool', () => {
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
    it('exposes clickstack_emerging_signals via tools/list with current + baseline windows', async () => {
      const { tools } = await client.listTools();
      const t = tools.find(t => t.name === 'clickstack_emerging_signals');
      expect(t).toBeDefined();
      const schema = t!.inputSchema;
      const props = Object.keys(schema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('currentStartTime');
      expect(props).toContain('currentEndTime');
      expect(props).toContain('baselineStartTime');
      expect(props).toContain('baselineEndTime');
      expect(props).toContain('minShareRatio');
      expect(props).toContain('topN');
      expect(schema.required).toContain('sourceId');
      expect(schema.required).toContain('currentStartTime');
      expect(schema.required).toContain('baselineStartTime');
    });
  });

  describe('validation', () => {
    it('rejects overlapping baseline and current windows', async () => {
      const result = await callTool(client, 'clickstack_emerging_signals', {
        sourceId: logSource._id.toString(),
        // Baseline [00:00, 00:40) overlaps current [00:30, 01:00).
        baselineStartTime: '2026-05-10T00:00:00Z',
        baselineEndTime: '2026-05-10T00:40:00Z',
        currentStartTime: '2026-05-10T00:30:00Z',
        currentEndTime: '2026-05-10T01:00:00Z',
      });
      expect(result.isError).toBeTruthy();
      expect(getFirstText(result)).toMatch(/overlap/i);
    });

    it('rejects a current window where endTime <= startTime', async () => {
      const result = await callTool(client, 'clickstack_emerging_signals', {
        sourceId: logSource._id.toString(),
        baselineStartTime: '2026-05-10T00:00:00Z',
        baselineEndTime: '2026-05-10T00:30:00Z',
        currentStartTime: '2026-05-10T01:00:00Z',
        currentEndTime: '2026-05-10T01:00:00Z',
      });
      expect(result.isError).toBeTruthy();
      expect(getFirstText(result)).toMatch(/current window/i);
    });
  });

  describe('algorithm against ClickHouse', () => {
    // Capture once so insert timestamps and query windows stay consistent.
    let now: number;

    beforeEach(async () => {
      now = Date.now();
      const events: Array<{
        Body: string;
        ServiceName: string;
        SeverityText: string;
        Timestamp: Date;
      }> = [];

      // Baseline window (5–10 min ago): a single steady-state log template,
      // spread evenly across the whole 5-minute region so any sub-window of it
      // is populated. The "checkout" line is common in BOTH windows, so it must
      // NOT be reported as emerging.
      const baselineStart = now - 10 * 60_000;
      for (let i = 0; i < 300; i++) {
        events.push({
          Body: `checkout completed order=${i} amount=${i % 50}`,
          ServiceName: 'checkout',
          SeverityText: 'INFO',
          // Spread across ~5 min (300 × 1s), i.e. now-10min .. now-5min.
          Timestamp: new Date(baselineStart + i * 1000),
        });
      }

      // Current window (last 5 min): the same steady-state template PLUS a
      // brand-new template that never appeared in baseline — a feature-flag
      // shadow-eval line. Drain clusters each into its own template, and the
      // shadow-eval one has no baseline counterpart → status "new".
      const currentStart = now - 5 * 60_000;
      for (let i = 0; i < 300; i++) {
        events.push({
          Body: `checkout completed order=${i} amount=${i % 50}`,
          ServiceName: 'checkout',
          SeverityText: 'INFO',
          Timestamp: new Date(currentStart + i * 1000),
        });
      }
      for (let i = 0; i < 150; i++) {
        events.push({
          Body: `shadow-eval flag=new_pricing variant=${i % 3} latency_ms=${i}`,
          ServiceName: 'checkout',
          SeverityText: 'INFO',
          Timestamp: new Date(currentStart + i * 1000),
        });
      }

      await bulkInsertLogs(events);
    });

    it('surfaces a brand-new log template as an emerging "new" signal', async () => {
      const result = await callTool(client, 'clickstack_emerging_signals', {
        sourceId: logSource._id.toString(),
        currentStartTime: new Date(now - 5 * 60_000).toISOString(),
        currentEndTime: new Date(now).toISOString(),
        baselineStartTime: new Date(now - 10 * 60_000).toISOString(),
        baselineEndTime: new Date(now - 5 * 60_000).toISOString(),
        sampleSize: 2000,
        topN: 10,
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));

      // Both windows sampled real data.
      expect(output.summary.currentWindow.sampled).toBeGreaterThan(0);
      expect(output.summary.baselineWindow.sampled).toBeGreaterThan(0);
      expect(output.summary.warning).toBeUndefined();

      // The shadow-eval template must appear in the emerging list as "new".
      expect(output.emerging.length).toBeGreaterThan(0);
      const shadow = (
        output.emerging as Array<{
          pattern: string;
          sample: string;
          status: string;
          currentShare: number;
          baselineShare: number;
        }>
      ).find(
        p => /shadow-eval/.test(p.pattern) || /shadow-eval/.test(p.sample),
      );
      expect(shadow).toBeDefined();
      expect(shadow!.status).toBe('new');
      expect(shadow!.baselineShare).toBe(0);
      expect(shadow!.currentShare).toBeGreaterThan(0);

      // The steady-state checkout template is present in both windows, so it
      // must NOT be reported as emerging.
      const checkoutEmerging = (
        output.emerging as Array<{ pattern: string; sample: string }>
      ).find(
        p =>
          /checkout completed/.test(p.pattern) ||
          /checkout completed/.test(p.sample),
      );
      expect(checkoutEmerging).toBeUndefined();
    });

    it('reports nothing novel when both windows share the same patterns', async () => {
      // Two non-overlapping halves of the baseline-only region (now-10min ..
      // now-5min). Both contain only the steady-state checkout template and
      // neither contains the shadow-eval template, so nothing should emerge.
      const result = await callTool(client, 'clickstack_emerging_signals', {
        sourceId: logSource._id.toString(),
        currentStartTime: new Date(now - 7.5 * 60_000).toISOString(),
        currentEndTime: new Date(now - 5 * 60_000).toISOString(),
        baselineStartTime: new Date(now - 10 * 60_000).toISOString(),
        baselineEndTime: new Date(now - 7.5 * 60_000).toISOString(),
        sampleSize: 2000,
        topN: 10,
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.summary.currentWindow.sampled).toBeGreaterThan(0);
      expect(output.summary.baselineWindow.sampled).toBeGreaterThan(0);
      // Neither window contains the shadow-eval template, so it must not show up.
      const shadow = (
        output.emerging as Array<{ pattern: string; sample: string }>
      ).find(
        p => /shadow-eval/.test(p.pattern) || /shadow-eval/.test(p.sample),
      );
      expect(shadow).toBeUndefined();
    });
  });
});
