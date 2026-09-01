import {
  MAX_ALERT_CHANNELS,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import { McpContext } from '@/mcp/tools/types';
import Alert, { AlertSource, AlertState } from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook, { WebhookService } from '@/models/webhook';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Alert Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let connection: any;
  let traceSource: any;
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

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ─── helpers ──────────────────────────────────────────────────────────────

  async function createTestSavedSearch() {
    return SavedSearch.create({
      team: team._id,
      name: 'Test Saved Search',
      source: traceSource._id,
    });
  }

  async function createTestDashboardWithTile() {
    return new Dashboard({
      name: 'Test Dashboard',
      team: team._id,
      tiles: [
        {
          id: 'tile-1',
          config: {
            name: 'Error Count',
            displayType: 'number',
            source: traceSource._id.toString(),
            series: [{ type: 'time', aggFn: 'count' }],
          },
        },
      ],
    }).save();
  }

  async function createTestWebhook() {
    return Webhook.create({
      team: team._id,
      name: 'Test Webhook',
      service: WebhookService.Generic,
      url: 'https://example.com/webhook',
    });
  }

  async function createTestAlert(overrides: Record<string, unknown> = {}) {
    const savedSearch = await createTestSavedSearch();
    return new Alert({
      team: team._id,
      source: 'saved_search',
      savedSearch: savedSearch._id,
      threshold: 100,
      thresholdType: 'above',
      interval: '5m',
      channel: { type: 'webhook', webhookId: 'fake-webhook-id' },
      state: AlertState.OK,
      createdBy: user._id,
      ...overrides,
    }).save();
  }

  // ─── clickstack_get_alert ────────────────────────────────────────────────────

  describe('clickstack_get_alert', () => {
    describe('list (no id)', () => {
      it('should list all alerts with slim summary fields', async () => {
        await createTestAlert({ name: 'Alert 1' });
        await createTestAlert({ name: 'Alert 2' });

        const result = await callTool(client, 'clickstack_get_alert', {});

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(2);

        // Slim summary fields present
        expect(output[0]).toHaveProperty('id');
        expect(output[0]).toHaveProperty('name');
        expect(output[0]).toHaveProperty('state');
        expect(output[0]).toHaveProperty('source');
        expect(output[0]).toHaveProperty('interval');

        // Full detail fields should NOT be present in list mode
        expect(output[0]).not.toHaveProperty('threshold');
        expect(output[0]).not.toHaveProperty('channel');
        expect(output[0]).not.toHaveProperty('history');
        expect(output[0]).not.toHaveProperty('teamId');
      });

      it('should return empty array when no alerts exist', async () => {
        const result = await callTool(client, 'clickstack_get_alert', {});

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(0);
      });

      it('should filter by state when provided', async () => {
        await createTestAlert({ name: 'Firing', state: AlertState.ALERT });
        await createTestAlert({ name: 'OK', state: AlertState.OK });
        await createTestAlert({ name: 'Disabled', state: AlertState.DISABLED });

        const result = await callTool(client, 'clickstack_get_alert', {
          state: 'ALERT',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(1);
        expect(output[0].name).toBe('Firing');
        expect(output[0].state).toBe('ALERT');
      });

      it('should return empty array when no alerts match state filter', async () => {
        await createTestAlert({ name: 'All Good', state: AlertState.OK });

        const result = await callTool(client, 'clickstack_get_alert', {
          state: 'ALERT',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(0);
      });

      it('should not return alerts from another team', async () => {
        await createTestAlert({ name: 'Team Scoped' });

        const otherTeamContext: McpContext = {
          teamId: '000000000000000000000099',
          userId: user._id.toString(),
        };
        const client2 = await createTestClient(otherTeamContext);

        // List should be empty for the other team
        const listResult = await callTool(client2, 'clickstack_get_alert', {});
        const output = JSON.parse(getFirstText(listResult));
        expect(output).toHaveLength(0);

        await client2.close();
      });

      it('should derive name from saved search when alert has no explicit name', async () => {
        const savedSearch = await createTestSavedSearch(); // name: 'Test Saved Search'
        await new Alert({
          team: team._id,
          source: 'saved_search',
          savedSearch: savedSearch._id,
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: { type: 'webhook', webhookId: 'fake-webhook-id' },
          state: AlertState.OK,
          createdBy: user._id,
          // no name set
        }).save();

        const result = await callTool(client, 'clickstack_get_alert', {});

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(1);
        expect(output[0].name).toBe('Test Saved Search');
      });

      it('should derive name from dashboard tile when tile alert has no explicit name', async () => {
        const dashboard = await createTestDashboardWithTile(); // tile name: 'Error Count'
        await new Alert({
          team: team._id,
          source: 'tile',
          dashboard: dashboard._id,
          tileId: 'tile-1',
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: { type: 'webhook', webhookId: 'fake-webhook-id' },
          state: AlertState.OK,
          createdBy: user._id,
          // no name set
        }).save();

        const result = await callTool(client, 'clickstack_get_alert', {});

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).toHaveLength(1);
        expect(output[0].name).toBe('Error Count');
      });
    });

    describe('detail (with id)', () => {
      it('should get full alert detail with history when valid id is provided', async () => {
        const alert = await createTestAlert({ name: 'Detail Test' });

        const result = await callTool(client, 'clickstack_get_alert', {
          id: alert._id.toString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.id).toBe(alert._id.toString());
        expect(output.name).toBe('Detail Test');
        expect(output).toHaveProperty('history');
        expect(Array.isArray(output.history)).toBe(true);
        // Full detail includes fields not in the list summary
        expect(output).toHaveProperty('threshold');
        expect(output).toHaveProperty('channel');
        expect(output).toHaveProperty('teamId');
      });

      it('should return error for invalid ObjectId format', async () => {
        const result = await callTool(client, 'clickstack_get_alert', {
          id: 'not-a-valid-id',
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Invalid alert ID');
      });

      it('should return error for non-existent alert id', async () => {
        const fakeId = '000000000000000000000000';
        const result = await callTool(client, 'clickstack_get_alert', {
          id: fakeId,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('not found');
      });

      it('should not return alert from another team by id', async () => {
        const alert = await createTestAlert({ name: 'Team Scoped' });

        const otherTeamContext: McpContext = {
          teamId: '000000000000000000000099',
          userId: user._id.toString(),
        };
        const client2 = await createTestClient(otherTeamContext);

        const getResult = await callTool(client2, 'clickstack_get_alert', {
          id: alert._id.toString(),
        });
        expect(getResult.isError).toBe(true);
        expect(getFirstText(getResult)).toContain('not found');

        await client2.close();
      });
    });
  });

  // ─── clickstack_save_alert ───────────────────────────────────────────────────

  describe('clickstack_save_alert', () => {
    describe('create', () => {
      it('should create a saved-search alert', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          name: 'MCP Created Alert',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.id).toBeDefined();
        expect(output.name).toBe('MCP Created Alert');
        expect(output.source).toBe('saved_search');
        expect(output.threshold).toBe(50);
        expect(output.state).toBe('OK');
      });

      it('should create a tile-based alert', async () => {
        const dashboard = await createTestDashboardWithTile();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'tile',
          dashboardId: dashboard._id.toString(),
          tileId: 'tile-1',
          threshold: 200,
          thresholdType: 'above',
          interval: '1h',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          name: 'Tile Alert',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.id).toBeDefined();
        expect(output.source).toBe('tile');
        expect(output.dashboardId).toBe(dashboard._id.toString());
        expect(output.tileId).toBe('tile-1');
      });

      it('should reject tile source without dashboardId', async () => {
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'tile',
          tileId: 'tile-1',
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('dashboardId is required');
      });

      it('should reject tile source without tileId', async () => {
        const dashboard = await createTestDashboardWithTile();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'tile',
          dashboardId: dashboard._id.toString(),
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('tileId is required');
      });

      it('should reject saved_search source without savedSearchId', async () => {
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('savedSearchId is required');
      });

      it('should reject non-existent saved search', async () => {
        const webhook = await createTestWebhook();
        const fakeId = '000000000000000000000000';

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: fakeId,
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Saved search not found');
      });

      it('should reject webhook channel without webhookId', async () => {
        const savedSearch = await createTestSavedSearch();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('webhookId');
      });

      it('should reject between thresholdType without thresholdMax', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 100,
          thresholdType: 'between',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('thresholdMax is required');
      });

      it('should return created alert in external format', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 75,
          thresholdType: 'below',
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          name: 'External Format Test',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        // External format uses 'id' not '_id'
        expect(output).toHaveProperty('id');
        expect(output).not.toHaveProperty('_id');
        expect(output).toHaveProperty('teamId');
        expect(output).toHaveProperty('createdAt');
      });
    });

    describe('inline alerts', () => {
      // External tile-config dialect, same as the dashboard tools.
      const makeChartConfig = (overrides: Record<string, unknown> = {}) => ({
        displayType: 'line',
        sourceId: traceSource._id.toString(),
        select: [
          {
            aggFn: 'count',
            where: 'StatusCode:STATUS_CODE_ERROR',
            whereLanguage: 'lucene',
          },
        ],
        ...overrides,
      });

      const makeInlineInput = (
        webhookId: string,
        overrides: Record<string, unknown> = {},
      ) => ({
        source: 'inline',
        chartConfig: makeChartConfig(),
        threshold: 10,
        thresholdType: 'above',
        interval: '5m',
        channel: { type: 'webhook', webhookId },
        name: 'Inline MCP Alert',
        ...overrides,
      });

      it('should create an inline alert and echo the external-dialect chartConfig', async () => {
        const webhook = await createTestWebhook();

        const result = await callTool(
          client,
          'clickstack_save_alert',
          makeInlineInput(webhook._id.toString()),
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.source).toBe('inline');
        expect(output.savedSearchId).toBeUndefined();
        expect(output.dashboardId).toBeUndefined();
        expect(output.chartConfig).toMatchObject({
          displayType: 'line',
          sourceId: traceSource._id.toString(),
          select: [
            {
              aggFn: 'count',
              where: 'StatusCode:STATUS_CODE_ERROR',
              whereLanguage: 'lucene',
            },
          ],
        });

        // Mongo persists the internal dialect the check-alerts task reads.
        const stored = await Alert.findById(output.id);
        expect(stored!.source).toBe(AlertSource.INLINE);
        expect(stored!.chartConfig).toMatchObject({
          source: traceSource._id.toString(),
          select: [
            {
              aggFn: 'count',
              aggCondition: 'StatusCode:STATUS_CODE_ERROR',
              aggConditionLanguage: 'lucene',
            },
          ],
        });
      });

      it('should update an inline alert chart config', async () => {
        const webhook = await createTestWebhook();

        const createResult = await callTool(
          client,
          'clickstack_save_alert',
          makeInlineInput(webhook._id.toString()),
        );
        const created = JSON.parse(getFirstText(createResult));

        const updateResult = await callTool(client, 'clickstack_save_alert', {
          ...makeInlineInput(webhook._id.toString(), {
            chartConfig: makeChartConfig({ groupBy: 'ServiceName' }),
            threshold: 42,
          }),
          id: created.id,
        });

        expect(updateResult.isError).toBeFalsy();
        const updated = JSON.parse(getFirstText(updateResult));
        expect(updated.threshold).toBe(42);
        expect(updated.chartConfig).toMatchObject({ groupBy: 'ServiceName' });

        const stored = await Alert.findById(created.id);
        expect(stored!.threshold).toBe(42);
        expect(stored!.chartConfig).toMatchObject({ groupBy: 'ServiceName' });
      });

      it('should reject inline source without chartConfig', async () => {
        const webhook = await createTestWebhook();

        const result = await callTool(
          client,
          'clickstack_save_alert',
          makeInlineInput(webhook._id.toString(), { chartConfig: undefined }),
        );

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('chartConfig is required');
      });

      it('should reject a chartConfig on a saved-search alert', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          chartConfig: makeChartConfig(),
          threshold: 10,
          thresholdType: 'above',
          interval: '5m',
          channel: { type: 'webhook', webhookId: webhook._id.toString() },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain(
          'only supported when source is "inline"',
        );
      });

      it('should reject a malformed metric formula', async () => {
        const webhook = await createTestWebhook();

        const result = await callTool(
          client,
          'clickstack_save_alert',
          makeInlineInput(webhook._id.toString(), {
            chartConfig: makeChartConfig({
              formulas: [{ expression: 'B * 2' }],
            }),
          }),
        );

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Invalid chartConfig');
      });

      it("should reject a source that does not belong to the team's sources", async () => {
        const webhook = await createTestWebhook();

        const result = await callTool(
          client,
          'clickstack_save_alert',
          makeInlineInput(webhook._id.toString(), {
            chartConfig: makeChartConfig({
              sourceId: new mongoose.Types.ObjectId().toString(),
            }),
          }),
        );

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Source not found');
      });

      it('clickstack_get_alert detail includes chartConfig and falls back to its name', async () => {
        const webhook = await createTestWebhook();

        const createResult = await callTool(
          client,
          'clickstack_save_alert',
          makeInlineInput(webhook._id.toString(), { name: undefined }),
        );
        const created = JSON.parse(getFirstText(createResult));

        // Seed a chartConfig name directly (the external dialect does not
        // carry one) to exercise the name fallback.
        await Alert.findByIdAndUpdate(created.id, {
          $set: { 'chartConfig.name': 'Error Rate Query' },
        });

        const detail = await callTool(client, 'clickstack_get_alert', {
          id: created.id,
        });
        expect(detail.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(detail));
        expect(output.chartConfig).toMatchObject({
          displayType: 'line',
          sourceId: traceSource._id.toString(),
        });
        expect(output.name).toBe('Error Rate Query');
      });
    });

    describe('multiple channels', () => {
      const namedWebhook = (name: string) =>
        Webhook.create({
          team: team._id,
          name,
          service: WebhookService.Generic,
          url: 'https://example.com/webhook',
        });

      it('should create an alert with several channels', async () => {
        const savedSearch = await createTestSavedSearch();
        const [w1, w2] = await Promise.all([
          namedWebhook('mcp-multi-1'),
          namedWebhook('mcp-multi-2'),
        ]);

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channels: [
            { type: 'webhook', webhookId: w1._id.toString() },
            { type: 'webhook', webhookId: w2._id.toString() },
          ],
          name: 'MCP Multi Channel Alert',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.channels).toEqual([
          { type: 'webhook', webhookId: w1._id.toString() },
          { type: 'webhook', webhookId: w2._id.toString() },
        ]);
        expect(output.channel).toEqual({
          type: 'webhook',
          webhookId: w1._id.toString(),
        });
      });

      it('should reject channel and channels that disagree', async () => {
        const savedSearch = await createTestSavedSearch();
        const [w1, w2] = await Promise.all([
          namedWebhook('mcp-mismatch-1'),
          namedWebhook('mcp-mismatch-2'),
        ]);

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channel: { type: 'webhook', webhookId: w1._id.toString() },
          channels: [{ type: 'webhook', webhookId: w2._id.toString() }],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('must match the first entry');
      });

      it('should reject duplicate channels', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await namedWebhook('mcp-dupe');
        const ch = { type: 'webhook', webhookId: webhook._id.toString() };

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channels: [ch, ch],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Duplicate');
      });

      it('should reject a payload with neither channel nor channels', async () => {
        const savedSearch = await createTestSavedSearch();

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
        });

        expect(result.isError).toBe(true);
      });

      // The MCP surface enforces the channel cap through the MCP SDK's own
      // Zod .max() parsing of the tool's inputSchema -- a protocol-level check
      // that runs before validateSaveAlertInput ever sees the payload. That is
      // a different enforcement path from the HTTP routers' superRefine (see
      // the "over the cap" case in routers/external-api/__tests__/alerts.int.test.ts),
      // so it needs its own coverage.
      it('should reject more than MAX_ALERT_CHANNELS channels', async () => {
        const savedSearch = await createTestSavedSearch();
        const many = Array.from({ length: MAX_ALERT_CHANNELS + 1 }, (_, i) => ({
          type: 'webhook' as const,
          webhookId: `fake-webhook-id-${i}`,
        }));

        const result = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channels: many,
        });

        expect(result.isError).toBe(true);
        const text = getFirstText(result);
        expect(text).toContain('channels');
        expect(text).toContain(String(MAX_ALERT_CHANNELS));
      });
    });

    describe('update', () => {
      it('should update an existing alert', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        // Create the alert first
        const alert = await new Alert({
          team: team._id,
          source: 'saved_search',
          savedSearch: savedSearch._id,
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          state: AlertState.OK,
          createdBy: user._id,
          name: 'Original Name',
        }).save();

        const result = await callTool(client, 'clickstack_save_alert', {
          id: alert._id.toString(),
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 200,
          thresholdType: 'above',
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          name: 'Updated Name',
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.id).toBe(alert._id.toString());
        expect(output.name).toBe('Updated Name');
        expect(output.threshold).toBe(200);
        expect(output.interval).toBe('15m');
      });

      // The update path above only exercises the legacy singular `channel`;
      // full-replace semantics on the agent surface are otherwise unverified.
      it('replaces the full channels array on update, keeping the legacy channel mirror in sync', async () => {
        const savedSearch = await createTestSavedSearch();
        const [w1, w2, w3, w4] = await Promise.all([
          Webhook.create({
            team: team._id,
            name: 'mcp-update-1',
            service: WebhookService.Generic,
            url: 'https://example.com/webhook',
          }),
          Webhook.create({
            team: team._id,
            name: 'mcp-update-2',
            service: WebhookService.Generic,
            url: 'https://example.com/webhook',
          }),
          Webhook.create({
            team: team._id,
            name: 'mcp-update-3',
            service: WebhookService.Generic,
            url: 'https://example.com/webhook',
          }),
          Webhook.create({
            team: team._id,
            name: 'mcp-update-4',
            service: WebhookService.Generic,
            url: 'https://example.com/webhook',
          }),
        ]);

        const created = await callTool(client, 'clickstack_save_alert', {
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channels: [
            { type: 'webhook', webhookId: w1._id.toString() },
            { type: 'webhook', webhookId: w2._id.toString() },
          ],
          name: 'Multi Channel Alert For Update',
        });
        expect(created.isError).toBeFalsy();
        const createdOutput = JSON.parse(getFirstText(created));

        const newChannels = [
          { type: 'webhook', webhookId: w3._id.toString() },
          { type: 'webhook', webhookId: w4._id.toString() },
        ];
        const updated = await callTool(client, 'clickstack_save_alert', {
          id: createdOutput.id,
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 50,
          thresholdType: 'above',
          interval: '5m',
          channels: newChannels,
          name: 'Multi Channel Alert For Update',
        });

        expect(updated.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(updated));
        expect(output.channels).toEqual(newChannels);
        expect(output.channel).toEqual(newChannels[0]);

        const persisted = await Alert.findById(createdOutput.id);
        expect(persisted?.channels).toEqual(newChannels);
        expect(persisted?.channel).toEqual(newChannels[0]);
      });

      it('should clear source-specific fields when both source field groups are provided', async () => {
        const savedSearch = await createTestSavedSearch();
        const dashboard = await createTestDashboardWithTile();
        const webhook = await createTestWebhook();
        const alert = await createTestAlert({
          groupBy: 'service.name',
          source: AlertSource.SAVED_SEARCH,
        });

        const tileResult = await callTool(client, 'clickstack_save_alert', {
          id: alert._id.toString(),
          source: 'tile',
          dashboardId: dashboard._id.toString(),
          tileId: 'tile-1',
          savedSearchId: savedSearch._id.toString(),
          groupBy: 'http.route',
          threshold: 200,
          thresholdType: 'above',
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });
        expect(tileResult.isError).toBeFalsy();

        let updatedAlert = await Alert.findById(alert._id);
        expect(updatedAlert?.source).toBe(AlertSource.TILE);
        expect(updatedAlert?.dashboard?.toString()).toBe(
          dashboard._id.toString(),
        );
        expect(updatedAlert?.tileId).toBe('tile-1');
        expect(updatedAlert?.savedSearch).toBeNull();
        expect(updatedAlert?.groupBy).toBeNull();

        const savedSearchResult = await callTool(
          client,
          'clickstack_save_alert',
          {
            id: alert._id.toString(),
            source: 'saved_search',
            savedSearchId: savedSearch._id.toString(),
            groupBy: 'http.route',
            dashboardId: dashboard._id.toString(),
            tileId: 'tile-1',
            threshold: 300,
            thresholdType: 'above',
            interval: '30m',
            channel: {
              type: 'webhook',
              webhookId: webhook._id.toString(),
            },
          },
        );
        expect(savedSearchResult.isError).toBeFalsy();

        updatedAlert = await Alert.findById(alert._id);
        expect(updatedAlert?.source).toBe(AlertSource.SAVED_SEARCH);
        expect(updatedAlert?.savedSearch?.toString()).toBe(
          savedSearch._id.toString(),
        );
        expect(updatedAlert?.groupBy).toBe('http.route');
        expect(updatedAlert?.dashboard).toBeNull();
        expect(updatedAlert?.tileId).toBeNull();
      });

      it('should return not found for non-existent alert id', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();
        const fakeId = '000000000000000000000000';

        const result = await callTool(client, 'clickstack_save_alert', {
          id: fakeId,
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('not found');
      });

      it('should return error for invalid ObjectId format on update', async () => {
        const savedSearch = await createTestSavedSearch();
        const webhook = await createTestWebhook();

        const result = await callTool(client, 'clickstack_save_alert', {
          id: '!!!',
          source: 'saved_search',
          savedSearchId: savedSearch._id.toString(),
          threshold: 100,
          thresholdType: 'above',
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Invalid alert ID');
      });
    });
  });

  // ─── clickstack_get_webhook ──────────────────────────────────────────────────

  describe('clickstack_get_webhook', () => {
    it('should list all webhooks with slim fields', async () => {
      await Webhook.create({
        team: team._id,
        name: 'Generic Hook',
        service: WebhookService.Generic,
        url: 'https://example.com/hook1',
      });
      await Webhook.create({
        team: team._id,
        name: 'Incident Hook',
        service: WebhookService.IncidentIO,
        url: 'https://example.com/hook2',
      });

      const result = await callTool(client, 'clickstack_get_webhook', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveLength(2);

      // Slim fields present
      expect(output[0]).toHaveProperty('id');
      expect(output[0]).toHaveProperty('name');
      expect(output[0]).toHaveProperty('service');

      // Sensitive/detail fields should NOT be present
      expect(output[0]).not.toHaveProperty('url');
      expect(output[0]).not.toHaveProperty('headers');
      expect(output[0]).not.toHaveProperty('queryParams');
      expect(output[0]).not.toHaveProperty('body');
    });

    it('should return empty array when no webhooks exist', async () => {
      const result = await callTool(client, 'clickstack_get_webhook', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveLength(0);
    });

    it('should scope webhooks to the team', async () => {
      await Webhook.create({
        team: team._id,
        name: 'Team Webhook',
        service: WebhookService.Generic,
        url: 'https://example.com/hook',
      });

      const otherTeamContext: McpContext = {
        teamId: '000000000000000000000099',
        userId: user._id.toString(),
      };
      const client2 = await createTestClient(otherTeamContext);

      const listResult = await callTool(client2, 'clickstack_get_webhook', {});
      const output = JSON.parse(getFirstText(listResult));
      expect(output).toHaveLength(0);

      await client2.close();
    });
  });
});
