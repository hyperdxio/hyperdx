import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { createServer } from 'http';
import mongoose from 'mongoose';
import ms from 'ms';

import * as config from '@/config';
import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { bulkInsertLogs, getServer } from '@/fixtures';
import Alert, {
  AlertChangeType,
  AlertConditionType,
  AlertSource,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';
import { processAlert } from '@/tasks/checkAlerts';
import {
  AlertDetails,
  AlertTaskType,
  loadProvider,
} from '@/tasks/checkAlerts/providers';
import * as slack from '@/utils/slack';

describe('Single Invocation Alert Test', () => {
  let alertProvider: any;
  let webhookServer: any;
  let receivedWebhooks: any[] = [];
  let server: any;

  beforeAll(async () => {
    alertProvider = await loadProvider();
    server = getServer();
    await server.start();
  });

  beforeEach(async () => {
    // Set up local webhook server
    receivedWebhooks = [];
    webhookServer = createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const parsedBody = JSON.parse(body);
            receivedWebhooks.push({
              headers: req.headers,
              body: parsedBody,
              url: req.url,
            });
          } catch {
            receivedWebhooks.push({
              headers: req.headers,
              body: body,
              url: req.url,
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
      } else {
        res.writeHead(405);
        res.end();
      }
    });

    // Start webhook server on a random port
    await new Promise<void>(resolve => {
      webhookServer.listen(0, () => {
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (webhookServer) {
      webhookServer.close();
    }
    await server.clearDBs();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should trigger alert and send webhook notification - happy path', async () => {
    // Mock slack webhook to avoid external calls
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    // Create team
    const team = await createTeam({ name: 'Test Team' });

    // Create connection to ClickHouse
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    // Create source
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: 'default',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });

    // Create saved search
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'Error Logs Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();

    // Create webhook
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/test123',
      name: 'Test Webhook',
    }).save();

    // Create alert
    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'Test Alert Name',
      },
      mockUserId,
    );

    // Insert test logs that will trigger the alert
    const now = new Date('2023-11-16T22:12:00.000Z');
    const eventTime = new Date(now.getTime() - ms('3m')); // 3 minutes ago

    await bulkInsertLogs([
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'Test error message',
      },
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'Test error message',
      },
    ]);

    // Get the alert with populated references
    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);

    // Process the alert - this should trigger the webhook
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    // Verify alert state changed to ALERT (from DB)
    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

    // Verify alert history was created
    const alertHistories = await AlertHistory.find({
      alert: alert.id,
    }).sort({ createdAt: 1 });

    expect(alertHistories.length).toBe(1);
    expect(alertHistories[0].state).toBe('ALERT');
    expect(alertHistories[0].counts).toBe(1);
    expect(alertHistories[0].lastValues.length).toBe(1);
    expect(alertHistories[0].lastValues[0].count).toBe(2); // 2 error logs found

    // Verify webhook was called exactly once
    expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);

    // Get the actual call to inspect it
    const webhookCall = (slack.postMessageToWebhook as jest.Mock).mock.calls[0];
    expect(webhookCall[0]).toBe('https://hooks.slack.com/services/test123');

    const webhookPayload = webhookCall[1];
    expect(webhookPayload).toMatchObject({
      text: expect.stringContaining('Test Alert Name'),
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'section',
          text: expect.objectContaining({
            type: 'mrkdwn',
            text: expect.stringContaining('lines found'),
          }),
        }),
      ]),
    });

    // The text should contain the alert name we specified
    expect(webhookPayload.text).toContain('Test Alert Name');

    // Verify the message body contains the search link
    const messageBody = webhookPayload.blocks[0].text.text;
    expect(messageBody).toContain('lines found');
    expect(messageBody).toContain('expected less than 1 lines');
    expect(messageBody).toContain('http://app:8080/search/');
    expect(messageBody).toContain('from=');
    expect(messageBody).toContain('to=');
    expect(messageBody).toContain('isLive=false');
  });

  it('should include saved search filters in alert ClickHouse query', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });

    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: 'default',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });

    // Create saved search with a lucene filter that restricts to ServiceName = "web"
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'Filtered Error Logs',
      select: 'Body',
      where: '',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
      filters: [
        {
          type: 'lucene',
          condition: 'ServiceName:"web"',
        },
      ],
    }).save();

    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/test-filters',
      name: 'Test Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'Filtered Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const eventTime = new Date(now.getTime() - ms('3m'));

    // Insert logs: 2 from "web" service, 2 from "api" service
    // Only "web" logs should be counted due to the filter
    await bulkInsertLogs([
      {
        ServiceName: 'web',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'Web error 1',
      },
      {
        ServiceName: 'web',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'Web error 2',
      },
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'API error 1',
      },
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'API error 2',
      },
    ]);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);

    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    // Alert should fire because 2 "web" logs exceed threshold of 1
    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

    const alertHistories = await AlertHistory.find({
      alert: alert.id,
    }).sort({ createdAt: 1 });

    expect(alertHistories.length).toBe(1);
    expect(alertHistories[0].state).toBe('ALERT');
    // Should count only 2 "web" logs, not all 4 logs
    expect(alertHistories[0].lastValues[0].count).toBe(2);
  });

  it('should not trigger alert when filters exclude all matching logs', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });

    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: 'default',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });

    // Create saved search with a filter for a service that has no logs
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'No Match Filter',
      select: 'Body',
      where: '',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
      filters: [
        {
          type: 'lucene',
          condition: 'ServiceName:"nonexistent-service"',
        },
      ],
    }).save();

    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/test-no-match',
      name: 'Test Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'No Match Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const eventTime = new Date(now.getTime() - ms('3m'));

    // Insert logs that DON'T match the filter
    await bulkInsertLogs([
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'API error',
      },
      {
        ServiceName: 'web',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'Web error',
      },
    ]);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);

    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    // Alert should NOT fire because filter excludes all logs
    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');

    // No webhook notification should be sent
    expect(slack.postMessageToWebhook).not.toHaveBeenCalled();
  });

  it('should apply both where clause and filters together in alert query', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });

    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: 'default',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });

    // Create saved search with BOTH a where clause and a filter
    // where: only errors, filter: only "web" service
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'Where + Filter Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
      filters: [
        {
          type: 'lucene',
          condition: 'ServiceName:"web"',
        },
      ],
    }).save();

    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/test-combined',
      name: 'Test Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 2,
        savedSearchId: savedSearch.id,
        name: 'Combined Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const eventTime = new Date(now.getTime() - ms('3m'));

    // Insert mix of logs:
    // - 1 web error (matches both where + filter)
    // - 1 web info (matches filter but NOT where)
    // - 2 api errors (matches where but NOT filter)
    // Only the 1 web error matches both conditions, which is < threshold of 2
    await bulkInsertLogs([
      {
        ServiceName: 'web',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'Web error',
      },
      {
        ServiceName: 'web',
        Timestamp: eventTime,
        SeverityText: 'info',
        Body: 'Web info',
      },
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'API error 1',
      },
      {
        ServiceName: 'api',
        Timestamp: eventTime,
        SeverityText: 'error',
        Body: 'API error 2',
      },
    ]);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);

    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    // Alert should NOT fire: only 1 web error matches both conditions,
    // which is below threshold of 2 (ABOVE uses >=)
    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');
    expect(slack.postMessageToWebhook).not.toHaveBeenCalled();
  });

  it('should use correct tile name in alert title when alerting tile is not first', async () => {
    // Mock slack webhook to avoid external calls
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    // Create team
    const team = await createTeam({ name: 'Test Team' });

    const now = new Date('2023-11-16T22:12:00.000Z');
    const eventMs = now.getTime() - ms('5m');

    // Insert logs that will trigger the alert
    await bulkInsertLogs([
      {
        ServiceName: 'api',
        Timestamp: new Date(eventMs),
        SeverityText: 'error',
        Body: 'Test error message',
      },
      {
        ServiceName: 'api',
        Timestamp: new Date(eventMs),
        SeverityText: 'error',
        Body: 'Test error message',
      },
      {
        ServiceName: 'api',
        Timestamp: new Date(eventMs),
        SeverityText: 'error',
        Body: 'Test error message',
      },
    ]);

    // Create connection
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    // Create source
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: {
        databaseName: 'default',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });

    // Create dashboard with multiple tiles - the alerting tile is NOT the first one
    const dashboard = await new Dashboard({
      name: 'Multi-Tile Dashboard',
      team: team._id,
      tiles: [
        {
          id: 'first-tile-id',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
          config: {
            name: 'First Tile Name', // This should NOT appear in alert title
            select: [
              {
                aggFn: 'count',
                aggCondition: 'ServiceName:api',
                valueExpression: '',
                aggConditionLanguage: 'lucene',
              },
            ],
            where: '',
            displayType: 'line',
            granularity: 'auto',
            source: source.id,
            groupBy: '',
          },
        },
        {
          id: 'second-tile-id',
          x: 6,
          y: 0,
          w: 6,
          h: 4,
          config: {
            name: 'Second Tile Name', // This SHOULD appear in alert title
            select: [
              {
                aggFn: 'count',
                aggCondition: 'SeverityText:error',
                valueExpression: '',
                aggConditionLanguage: 'lucene',
              },
            ],
            where: '',
            displayType: 'line',
            granularity: 'auto',
            source: source.id,
            groupBy: '',
          },
        },
      ],
    }).save();

    // Create webhook
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/test123',
      name: 'Test Webhook',
    }).save();

    // Create alert that references the SECOND tile (not the first)
    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.TILE,
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1, // Low threshold to trigger alert
        dashboardId: dashboard.id,
        tileId: 'second-tile-id', // Alert references second tile, NOT first
      },
      mockUserId,
    );

    // Get enhanced alert with populated relations
    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'dashboard',
    ]);

    // Find the tile we're alerting on (should be the second tile)
    const tile = dashboard.tiles?.find((t: any) => t.id === 'second-tile-id');
    if (!tile) throw new Error('Second tile not found for multi-tile test');

    // Set up alert processing details (like existing tile tests)
    const details = {
      alert: enhancedAlert,
      source,
      taskType: AlertTaskType.TILE,
      tile,
      dashboard,
      previousMap: new Map(),
    } satisfies AlertDetails;

    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    const mockMetadata = {
      getColumn: jest.fn().mockImplementation(({ column }) => {
        const columnMap = {
          ServiceName: { name: 'ServiceName', type: 'String' },
          Timestamp: { name: 'Timestamp', type: 'DateTime' },
          SeverityText: { name: 'SeverityText', type: 'String' },
          Body: { name: 'Body', type: 'String' },
        };
        return Promise.resolve(columnMap[column]);
      }),
    };

    // Mock the getMetadata function
    jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
      ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
      getMetadata: jest.fn().mockReturnValue(mockMetadata),
    }));

    // Process alert - this triggers the webhook with the title
    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    // Get the webhook call to inspect the title
    expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    const webhookCall = (slack.postMessageToWebhook as jest.Mock).mock.calls[0];
    const messageText = webhookCall[1].text;

    // This assertion SHOULD pass but WILL FAIL due to the bug
    // The bug causes buildAlertMessageTemplateTitle to use dashboard.tiles[0] (First Tile Name)
    // instead of finding the correct tile by ID (Second Tile Name)
    expect(messageText).toContain('Second Tile Name'); // Should find the correct tile
    expect(messageText).not.toContain('First Tile Name'); // Should NOT use first tile

    // Verify our test setup is correct
    expect(dashboard.tiles).toHaveLength(2);
    expect(dashboard.tiles[0].config.name).toBe('First Tile Name');
    expect(dashboard.tiles[1].config.name).toBe('Second Tile Name');
    expect(enhancedAlert.tileId).toBe('second-tile-id');
  });

  it('should trigger rate-of-change alert (absolute) when change exceeds threshold', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'RoC Abs Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/roc-abs',
      name: 'RoC Abs Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 5,
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.ABSOLUTE,
        savedSearchId: savedSearch.id,
        name: 'RoC Absolute Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const window1Time = new Date('2023-11-16T22:02:00.000Z');
    const window2Time = new Date('2023-11-16T22:07:00.000Z');

    const window1Logs = Array.from({ length: 2 }, () => ({
      ServiceName: 'api',
      Timestamp: window1Time,
      SeverityText: 'error',
      Body: 'Window 1 error',
    }));
    const window2Logs = Array.from({ length: 8 }, () => ({
      ServiceName: 'api',
      Timestamp: window2Time,
      SeverityText: 'error',
      Body: 'Window 2 error',
    }));
    await bulkInsertLogs([...window1Logs, ...window2Logs]);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');
    const histories = await AlertHistory.find({ alert: alert.id });
    expect(histories.length).toBe(1);
    expect(histories[0].state).toBe('ALERT');
    expect(histories[0].counts).toBe(1);
    expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
  });

  it('should trigger rate-of-change alert (percentage) when % change exceeds threshold', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'RoC Pct Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/roc-pct',
      name: 'RoC Pct Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 100,
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.PERCENTAGE,
        savedSearchId: savedSearch.id,
        name: 'RoC Percentage Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const window1Time = new Date('2023-11-16T22:02:00.000Z');
    const window2Time = new Date('2023-11-16T22:07:00.000Z');

    const window1Logs = Array.from({ length: 4 }, () => ({
      ServiceName: 'api',
      Timestamp: window1Time,
      SeverityText: 'error',
      Body: 'Window 1 error',
    }));
    const window2Logs = Array.from({ length: 12 }, () => ({
      ServiceName: 'api',
      Timestamp: window2Time,
      SeverityText: 'error',
      Body: 'Window 2 error',
    }));
    await bulkInsertLogs([...window1Logs, ...window2Logs]);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');
    const histories = await AlertHistory.find({ alert: alert.id });
    expect(histories.length).toBe(1);
    expect(histories[0].state).toBe('ALERT');
    expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
  });

  it('should NOT trigger rate-of-change alert when change is below threshold', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'RoC NoFire Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/roc-nofire',
      name: 'RoC NoFire Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 5,
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.ABSOLUTE,
        savedSearchId: savedSearch.id,
        name: 'RoC NoFire Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const window1Time = new Date('2023-11-16T22:02:00.000Z');
    const window2Time = new Date('2023-11-16T22:07:00.000Z');

    const window1Logs = Array.from({ length: 5 }, () => ({
      ServiceName: 'api',
      Timestamp: window1Time,
      SeverityText: 'error',
      Body: 'Window 1 error',
    }));
    const window2Logs = Array.from({ length: 6 }, () => ({
      ServiceName: 'api',
      Timestamp: window2Time,
      SeverityText: 'error',
      Body: 'Window 2 error',
    }));
    await bulkInsertLogs([...window1Logs, ...window2Logs]);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');
    const histories = await AlertHistory.find({ alert: alert.id });
    expect(histories.length).toBe(1);
    expect(histories[0].state).toBe('OK');
    expect(slack.postMessageToWebhook).not.toHaveBeenCalled();
  });

  it('should trigger rate-of-change alert with empty baseline window (0 previous logs)', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'RoC Empty Baseline Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/roc-empty',
      name: 'RoC Empty Baseline Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 3,
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.ABSOLUTE,
        savedSearchId: savedSearch.id,
        name: 'RoC Empty Baseline Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const window2Time = new Date('2023-11-16T22:07:00.000Z');

    const window2Logs = Array.from({ length: 5 }, () => ({
      ServiceName: 'api',
      Timestamp: window2Time,
      SeverityText: 'error',
      Body: 'Window 2 error',
    }));
    await bulkInsertLogs(window2Logs);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');
    const histories = await AlertHistory.find({ alert: alert.id });
    expect(histories.length).toBe(1);
    expect(histories[0].state).toBe('ALERT');
    expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
  });

  it('should NOT trigger percentage rate-of-change alert when baseline is empty (Infinity guard)', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'RoC Infinity Guard Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/roc-inf-guard',
      name: 'RoC Infinity Guard Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 50,
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.PERCENTAGE,
        savedSearchId: savedSearch.id,
        name: 'RoC Infinity Guard Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const window2Time = new Date('2023-11-16T22:07:00.000Z');

    // Insert logs only in window 2 (none in baseline window 1).
    // Percentage RoC from 0 -> N would be Infinity, which the guard should skip.
    const window2Logs = Array.from({ length: 5 }, () => ({
      ServiceName: 'api',
      Timestamp: window2Time,
      SeverityText: 'error',
      Body: 'Window 2 error',
    }));
    await bulkInsertLogs(window2Logs);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    // The percentage change from 0 to 5 is Infinity, so the guard should
    // prevent the alert from firing -- no ALERT state, no notification.
    expect((await Alert.findById(enhancedAlert.id))!.state).not.toBe('ALERT');
    const histories = await AlertHistory.find({ alert: alert.id });
    const alertingHistories = histories.filter(h => h.state === 'ALERT');
    expect(alertingHistories.length).toBe(0);
    expect(slack.postMessageToWebhook).not.toHaveBeenCalled();
  });

  it('should trigger grouped rate-of-change alert when all groups drop to zero (empty bucket)', async () => {
    jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

    const team = await createTeam({ name: 'Test Team' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: 'log',
      team: team._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      connection: connection.id,
      name: 'Test Logs',
    });
    const savedSearch = await new SavedSearch({
      team: team._id,
      name: 'RoC GroupBy Search',
      select: 'Body',
      where: 'SeverityText: "error"',
      whereLanguage: 'lucene',
      orderBy: 'Timestamp',
      source: source.id,
      tags: ['test'],
    }).save();
    const webhook = await new Webhook({
      team: team._id,
      service: 'slack',
      url: 'https://hooks.slack.com/services/roc-groupby',
      name: 'RoC GroupBy Webhook',
    }).save();

    const mockUserId = new mongoose.Types.ObjectId();
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channel: { type: 'webhook', webhookId: webhook._id.toString() },
        interval: '5m',
        thresholdType: AlertThresholdType.BELOW,
        threshold: 0,
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.ABSOLUTE,
        groupBy: 'ServiceName',
        savedSearchId: savedSearch.id,
        name: 'RoC GroupBy Alert',
      },
      mockUserId,
    );

    const now = new Date('2023-11-16T22:12:00.000Z');
    const window1Time = new Date('2023-11-16T22:02:00.000Z');

    // Baseline window has logs for two groups; evaluation window has none
    const window1Logs = [
      ...Array.from({ length: 5 }, () => ({
        ServiceName: 'api',
        Timestamp: window1Time,
        SeverityText: 'error',
        Body: 'Window 1 api error',
      })),
      ...Array.from({ length: 3 }, () => ({
        ServiceName: 'web',
        Timestamp: window1Time,
        SeverityText: 'error',
        Body: 'Window 1 web error',
      })),
    ];
    await bulkInsertLogs(window1Logs);

    const enhancedAlert: any = await Alert.findById(alert.id).populate([
      'team',
      'savedSearch',
    ]);
    const details: any = {
      alert: enhancedAlert,
      source,
      conn: connection,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
      previousMap: new Map(),
    };
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    await processAlert(
      now,
      details,
      clickhouseClient,
      connection.id,
      alertProvider,
      new Map([[webhook.id.toString(), webhook]]),
    );

    expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');
    const histories = await AlertHistory.find({ alert: alert.id });
    const alertingHistories = histories.filter(h => h.state === 'ALERT');
    // Both groups (api and web) should fire since they each dropped to 0
    expect(alertingHistories.length).toBeGreaterThanOrEqual(1);
    expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
  });
});
