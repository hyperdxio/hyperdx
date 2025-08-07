import { createServer } from 'http';
import ms from 'ms';

import * as config from '@/config';
import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { bulkInsertLogs, getServer } from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Connection from '@/models/connection';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';
import { processAlert } from '@/tasks/checkAlerts';
import { loadProvider } from '@/tasks/providers';
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
    const alert = await createAlert(team._id, {
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
    });

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
    const enhancedAlert: any = await Alert.findById(alert._id).populate([
      'team',
      'savedSearch',
    ]);

    // Process the alert - this should trigger the webhook
    await processAlert(now, enhancedAlert, alertProvider);

    // Verify alert state changed to ALERT
    expect(enhancedAlert.state).toBe('ALERT');

    // Verify alert history was created
    const alertHistories = await AlertHistory.find({
      alert: alert._id,
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
});
