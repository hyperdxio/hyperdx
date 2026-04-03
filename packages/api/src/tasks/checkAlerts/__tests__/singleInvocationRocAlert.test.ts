import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { createServer } from 'http';
import mongoose from 'mongoose';

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
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';
import { processAlert } from '@/tasks/checkAlerts';
import { AlertTaskType, loadProvider } from '@/tasks/checkAlerts/providers';
import * as slack from '@/utils/slack';

describe('Single Invocation Rate-of-Change Alert Test', () => {
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
