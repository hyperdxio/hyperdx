import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { AlertState } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';

import * as config from '@/config';
import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import {
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  DEFAULT_DATABASE,
  DEFAULT_METRICS_TABLE,
  getServer,
  makeTile,
} from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';
import * as checkAlert from '@/tasks/checkAlerts';
import {
  doesExceedThreshold,
  getPreviousAlertHistories,
  processAlert,
} from '@/tasks/checkAlerts';
import {
  AlertDetails,
  AlertTaskType,
  loadProvider,
} from '@/tasks/checkAlerts/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateHdxLink,
  buildAlertMessageTemplateTitle,
  getDefaultExternalAction,
  renderAlertTemplate,
  translateExternalActionsToInternal,
} from '@/tasks/checkAlerts/template';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';

// Create provider instance for tests
let alertProvider: any;

beforeAll(async () => {
  alertProvider = await loadProvider();
});

describe('checkAlerts', () => {
  describe('doesExceedThreshold', () => {
    it('should return true when value exceeds ABOVE threshold', () => {
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 10, 11)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 10, 10)).toBe(true);
    });

    it('should return true when value is below BELOW threshold', () => {
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 10, 9)).toBe(true);
    });

    it('should return false when value equals BELOW threshold', () => {
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 10, 10)).toBe(false);
    });

    it('should return false when value is below ABOVE threshold', () => {
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 10, 9)).toBe(false);
    });

    it('should return false when value is above BELOW threshold', () => {
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 10, 11)).toBe(false);
    });

    it('should handle zero values correctly', () => {
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 0, 1)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 0, 0)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 0, -1)).toBe(false);
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 0, -1)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 0, 0)).toBe(false);
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 0, 1)).toBe(false);
    });

    it('should handle negative values correctly', () => {
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, -5, -3)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, -5, -5)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, -5, -7)).toBe(false);
      expect(doesExceedThreshold(AlertThresholdType.BELOW, -5, -7)).toBe(true);
      expect(doesExceedThreshold(AlertThresholdType.BELOW, -5, -5)).toBe(false);
      expect(doesExceedThreshold(AlertThresholdType.BELOW, -5, -3)).toBe(false);
    });

    it('should handle decimal values correctly', () => {
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 10.5, 11.0)).toBe(
        true,
      );
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 10.5, 10.5)).toBe(
        true,
      );
      expect(doesExceedThreshold(AlertThresholdType.ABOVE, 10.5, 10.0)).toBe(
        false,
      );
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 10.5, 10.0)).toBe(
        true,
      );
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 10.5, 10.5)).toBe(
        false,
      );
      expect(doesExceedThreshold(AlertThresholdType.BELOW, 10.5, 11.0)).toBe(
        false,
      );
    });
  });

  describe('Alert Templates', () => {
    const defaultSearchView: AlertMessageTemplateDefaultView = {
      alert: {
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        source: AlertSource.SAVED_SEARCH,
        channel: {
          type: 'webhook',
          webhookId: 'fake-webhook-id',
        },
        interval: '1m',
      },
      source: {
        id: 'fake-source-id' as any,
        kind: 'log' as any,
        team: 'team-123' as any,
        from: {
          databaseName: 'default',
          tableName: 'otel_logs',
        },
        timestampValueExpression: 'Timestamp',
        connection: 'connection-123' as any,
        name: 'Logs',
      },
      savedSearch: {
        _id: 'fake-saved-search-id' as any,
        team: 'team-123' as any,
        id: 'fake-saved-search-id',
        name: 'My Search',
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: 'fake-source-id' as any,
        tags: ['test'],
      },
      attributes: {},
      granularity: '1m',
      group: 'http',
      startTime: new Date('2023-03-17T22:13:03.103Z'),
      endTime: new Date('2023-03-17T22:13:59.103Z'),
      value: 10,
    };

    const testTile = makeTile({ id: 'test-tile-id' });
    const defaultChartView: AlertMessageTemplateDefaultView = {
      alert: {
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        source: AlertSource.TILE,
        channel: {
          type: 'webhook',
          webhookId: 'fake-webhook-id',
        },
        interval: '1m',
        tileId: 'test-tile-id',
      },
      dashboard: {
        _id: new mongoose.Types.ObjectId(),
        id: 'id-123',
        name: 'My Dashboard',
        tiles: [testTile],
        team: 'team-123' as any,
        tags: ['test'],
      },
      startTime: new Date('2023-03-17T22:13:03.103Z'),
      endTime: new Date('2023-03-17T22:13:59.103Z'),
      attributes: {},
      granularity: '5 minute',
      value: 5,
    };

    const server = getServer();

    beforeAll(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.clearDBs();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('buildAlertMessageTemplateHdxLink', () => {
      expect(
        buildAlertMessageTemplateHdxLink(alertProvider, defaultSearchView),
      ).toMatchInlineSnapshot(
        `"http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false"`,
      );
      expect(
        buildAlertMessageTemplateHdxLink(alertProvider, defaultChartView),
      ).toMatchInlineSnapshot(
        `"http://app:8080/dashboards/id-123?from=1679089083103&granularity=5+minute&to=1679093339103"`,
      );
    });

    it('buildAlertMessageTemplateTitle', () => {
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultSearchView,
        }),
      ).toMatchInlineSnapshot(`"Alert for \\"My Search\\" - 10 lines found"`);
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultChartView,
        }),
      ).toMatchInlineSnapshot(
        `"Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 5 exceeds 1"`,
      );
    });

    it('getDefaultExternalAction', () => {
      expect(
        getDefaultExternalAction({
          channel: {
            type: 'webhook',
            webhookId: '123',
          },
        } as any),
      ).toBe('@webhook-123');
      expect(
        getDefaultExternalAction({
          channel: {
            type: 'foo',
          },
        } as any),
      ).toBeNull();
    });

    it('translateExternalActionsToInternal', () => {
      // normal
      expect(
        translateExternalActionsToInternal('@webhook-123'),
      ).toMatchInlineSnapshot(
        `"{{__hdx_notify_channel__ channel=\\"webhook\\" id=\\"123\\"}}"`,
      );

      // with multiple breaks
      expect(
        translateExternalActionsToInternal(`

@webhook-123
`),
      ).toMatchInlineSnapshot(`
"
{{__hdx_notify_channel__ channel=\\"webhook\\" id=\\"123\\"}}
"
`);

      // with body string
      expect(
        translateExternalActionsToInternal('blabla @action-id'),
      ).toMatchInlineSnapshot(
        `"blabla {{__hdx_notify_channel__ channel=\\"action\\" id=\\"id\\"}}"`,
      );

      // multiple actions
      expect(
        translateExternalActionsToInternal('blabla @action-id @action2-id2'),
      ).toMatchInlineSnapshot(
        `"blabla {{__hdx_notify_channel__ channel=\\"action\\" id=\\"id\\"}} {{__hdx_notify_channel__ channel=\\"action2\\" id=\\"id2\\"}}"`,
      );

      // id with special characters
      expect(
        translateExternalActionsToInternal('send @email-mike@hyperdx.io'),
      ).toMatchInlineSnapshot(
        `"send {{__hdx_notify_channel__ channel=\\"email\\" id=\\"mike@hyperdx.io\\"}}"`,
      );

      // id with multiple dashes
      expect(
        translateExternalActionsToInternal('@action-id-with-multiple-dashes'),
      ).toMatchInlineSnapshot(
        `"{{__hdx_notify_channel__ channel=\\"action\\" id=\\"id-with-multiple-dashes\\"}}"`,
      );

      // custom template id
      expect(
        translateExternalActionsToInternal('@action-{{action_id}}'),
      ).toMatchInlineSnapshot(
        `"{{__hdx_notify_channel__ channel=\\"action\\" id=\\"{{action_id}}\\"}}"`,
      );
    });

    it('renderAlertTemplate - with existing channel', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: {} as any,
        metadata: {} as any,
        state: AlertState.ALERT,
        template: 'Custom body @webhook-My_Web', // partial name should work
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: 'webhook',
              webhookId: webhook._id.toString(),
            },
          },
        },
        title: 'Alert for "My Search" - 10 lines found',
        teamWebhooksById: new Map<string, typeof webhook>([
          [webhook._id.toString(), webhook],
        ]),
      });

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
      // TODO: test call arguments
    });

    it('renderAlertTemplate - custom body with single action', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: {} as any,
        metadata: {} as any,
        state: AlertState.ALERT,
        template: 'Custom body @webhook-My_Web', // partial name should work
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: null, // using template instead
            },
          },
        },
        title: 'Alert for "My Search" - 10 lines found',
        teamWebhooksById: new Map<string, typeof webhook>([
          [webhook._id.toString(), webhook],
        ]),
      });

      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  'Time Range (UTC): [Mar 17 10:13:03 PM - Mar 17 10:13:59 PM)',
                  'Custom body ',
                  '```',
                  '',
                  '```',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );
    });

    it('renderAlertTemplate - single action with custom action id', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: {} as any,
        metadata: {} as any,
        state: AlertState.ALERT,
        template: 'Custom body @webhook-{{attributes.webhookName}}', // partial name should work
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: null, // using template instead
            },
          },
          attributes: {
            webhookName: 'My_Webhook',
          },
        },
        title: 'Alert for "My Search" - 10 lines found',
        teamWebhooksById: new Map<string, typeof webhook>([
          [webhook._id.toString(), webhook],
        ]),
      });

      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  'Time Range (UTC): [Mar 17 10:13:03 PM - Mar 17 10:13:59 PM)',
                  'Custom body ',
                  '```',
                  '',
                  '```',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );
    });

    it('renderAlertTemplate - #is_match with single action', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });
      const myWebhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();
      const anotherWebhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/456',
        name: 'Another_Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof anotherWebhook>([
        [anotherWebhook._id.toString(), anotherWebhook],
        [myWebhook._id.toString(), myWebhook],
      ]);

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: {} as any,
        metadata: {} as any,
        state: AlertState.ALERT,
        template: `
{{#is_match "attributes.k8s.pod.name" "otel-collector-123"}}
  Runbook URL: {{attributes.runbook.url}}
  hi i matched
  @webhook-My_Web
{{/is_match}}

@webhook-Another_Webhook
`, // partial name should work
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: null, // using template instead
            },
          },
          attributes: {
            runbook: {
              url: 'https://example.com',
            },
            k8s: {
              pod: {
                name: 'otel-collector-123',
              },
            },
          },
        },
        title: 'Alert for "My Search" - 10 lines found',
        teamWebhooksById,
      });

      // @webhook should not be called
      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: {} as any,
        metadata: {} as any,
        state: AlertState.ALERT,
        template:
          '{{#is_match "attributes.host" "web"}} @webhook-My_Web {{/is_match}}', // partial name should work
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: null, // using template instead
            },
          },
          attributes: {
            host: 'web2',
          },
        },
        title: 'Alert for "My Search" - 10 lines found',
        teamWebhooksById,
      });

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
      expect(slack.postMessageToWebhook).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  'Time Range (UTC): [Mar 17 10:13:03 PM - Mar 17 10:13:59 PM)',
                  '',
                  '  Runbook URL: https://example.com',
                  '  hi i matched',
                  '  ',
                  '',
                  '',
                  '```',
                  '',
                  '```',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );
      expect(slack.postMessageToWebhook).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/456',
        {
          text: 'Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  'Time Range (UTC): [Mar 17 10:13:03 PM - Mar 17 10:13:59 PM)',
                  '',
                  '  Runbook URL: https://example.com',
                  '  hi i matched',
                  '  ',
                  '',
                  '',
                  '```',
                  '',
                  '```',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );
    });
  });

  describe('processAlert', () => {
    const server = getServer();

    beforeAll(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.clearDBs();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('SAVED_SEARCH alert - slack webhook', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');
      const eventNextMs = new Date('2023-11-16T22:10:00.000Z');

      await bulkInsertLogs([
        // logs from 22:05 - 22:10
        {
          ServiceName: 'api',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // logs from 22:10 - 22:15
        {
          ServiceName: 'api',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
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
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      // Mock the getMetadata function
      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // should fetch 5m of logs
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      const previousAlertsLater = await getPreviousAlertHistories(
        [enhancedAlert.id],
        later,
      );
      await processAlert(
        later,
        {
          ...details,
          previousMap: previousAlertsLater,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        {
          ...details,
          previousMap: previousAlertsNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      const nextNextWindow = new Date('2023-11-16T22:20:00.000Z');
      const previousAlertsNextNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextNextWindow,
      );
      await processAlert(
        nextNextWindow,
        {
          ...details,
          previousMap: previousAlertsNextNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(3);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );
      expect(alertHistories[1].state).toBe('ALERT');
      expect(alertHistories[1].counts).toBe(1);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );
      expect(alertHistories[2].state).toBe('OK');
      expect(alertHistories[2].counts).toBe(0);
      expect(alertHistories[2].createdAt).toEqual(
        new Date('2023-11-16T22:20:00.000Z'),
      );

      // check if webhook was triggered
      // We're only checking the general structure here since the exact text includes timestamps
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "My Search" - 3 lines found',
          blocks: [
            {
              text: expect.any(Object),
              type: 'section',
            },
          ],
        },
      );
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        2,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "My Search" - 1 lines found',
          blocks: [
            {
              text: expect.any(Object),
              type: 'section',
            },
          ],
        },
      );
    });

    it('TILE alert (events) - slack webhook', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:12:00.000Z');
      // Send events in the last alert window 22:05 - 22:10
      const eventMs = now.getTime() - ms('5m');

      await bulkInsertLogs([
        {
          ServiceName: 'api',
          Timestamp: new Date(eventMs),
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: new Date(eventMs),
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: new Date(eventMs),
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        tiles: [
          {
            id: '17quud',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            config: {
              name: 'Logs Count',
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
        ],
      }).save();
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
          threshold: 1,
          dashboardId: dashboard.id,
          tileId: '17quud',
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'dashboard',
      ]);

      const tile = dashboard.tiles?.find((t: any) => t.id === '17quud');
      if (!tile) throw new Error('tile not found for dashboard test case');
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

      // should fetch 5m of logs
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      const previousAlertsLater = await getPreviousAlertHistories(
        [enhancedAlert.id],
        later,
      );
      await processAlert(
        later,
        {
          ...details,
          previousMap: previousAlertsLater,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        {
          ...details,
          previousMap: previousAlertsNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({
        createdAt: 1,
      });

      expect(alertHistories.length).toBe(2);
      const [history1, history2] = alertHistories;
      expect(history1.state).toBe('ALERT');
      expect(history1.counts).toBe(1);
      expect(history1.createdAt).toEqual(new Date('2023-11-16T22:10:00.000Z'));
      expect(history1.lastValues.length).toBe(1);
      expect(history1.lastValues[0].count).toBeGreaterThanOrEqual(1);

      expect(history2.state).toBe('OK');
      expect(history2.counts).toBe(0);
      expect(history2.createdAt).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      // check if webhook was triggered
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1',
          blocks: [
            {
              text: {
                text: [
                  `*<http://app:8080/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1>*`,
                  '',
                  '3 exceeds 1',
                  'Time Range (UTC): [Nov 16 10:05:00 PM - Nov 16 10:10:00 PM)',
                  '',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );
    });

    it('TILE alert (events) - generic webhook', async () => {
      jest.spyOn(checkAlert, 'handleSendGenericWebhook');

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      });
      global.fetch = fetchMock;

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:12:00.000Z');
      // Send events in the last alert window 22:05 - 22:10
      const eventMs = now.getTime() - ms('5m');

      await bulkInsertLogs([
        {
          ServiceName: 'api',
          Timestamp: new Date(eventMs),
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: new Date(eventMs),
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: new Date(eventMs),
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'generic',
        url: 'https://webhook.site/123',
        name: 'Generic Webhook',
        description: 'generic webhook description',
        body: JSON.stringify({
          text: '{{link}} | {{title}}',
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer test-token',
        },
      }).save();
      const webhooks = await Webhook.find({});
      const teamWebhooksById = new Map<string, typeof webhook>(
        webhooks.map(w => [w._id.toString(), w]),
      );
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        tiles: [
          {
            id: '17quud',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            config: {
              name: 'Logs Count',
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
        ],
      }).save();
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
          threshold: 1,
          dashboardId: dashboard.id,
          tileId: '17quud',
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'dashboard',
      ]);

      const tile = dashboard.tiles?.find((t: any) => t.id === '17quud');
      if (!tile)
        throw new Error('tile not found for dashboard generic webhook');
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

      // should fetch 5m of logs
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      const previousAlertsLater = await getPreviousAlertHistories(
        [enhancedAlert.id],
        later,
      );
      await processAlert(
        later,
        {
          ...details,
          previousMap: previousAlertsLater,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        {
          ...details,
          previousMap: previousAlertsNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({
        createdAt: 1,
      });

      expect(alertHistories.length).toBe(2);
      const [history1, history2] = alertHistories;
      expect(history1.state).toBe('ALERT');
      expect(history1.counts).toBe(1);
      expect(history1.createdAt).toEqual(new Date('2023-11-16T22:10:00.000Z'));
      expect(history1.lastValues.length).toBe(1);
      expect(history1.lastValues[0].count).toBeGreaterThanOrEqual(1);

      expect(history2.state).toBe('OK');
      expect(history2.counts).toBe(0);
      expect(history2.createdAt).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      // check if generic webhook was triggered, injected, and parsed, and sent correctly with custom headers
      expect(fetchMock).toHaveBeenCalledWith('https://webhook.site/123', {
        method: 'POST',
        body: JSON.stringify({
          text: `http://app:8080/dashboards/${dashboard.id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1`,
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer test-token',
        },
      });
    });

    it('Group-by alerts that resolve (missing data case)', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');
      const eventNextMs = new Date('2023-11-16T22:10:00.000Z');

      // Insert logs with different ServiceName values (group-by field)
      await bulkInsertLogs([
        // First window: 22:05 - 22:10 (both service-a and service-b breach threshold)
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-b',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        // Second window: 22:10 - 22:15 (only service-a breaches, service-b has no data)
        {
          ServiceName: 'service-a',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        // service-b has NO data in this window
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          groupBy: 'ServiceName', // Group by ServiceName
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
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
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      // Mock the getMetadata function
      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // First run: should trigger alerts for both service-a and service-b
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should be in ALERT state (because at least one group is alerting)
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // Check that we have 2 alert histories (one for each group)
      let alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(2);

      // Groups can include multiple fields, check that both groups exist
      const groups = alertHistories.map(h => h.group);
      expect(groups.some(g => g?.includes('service-a'))).toBe(true);
      expect(groups.some(g => g?.includes('service-b'))).toBe(true);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[1].state).toBe('ALERT');

      // Second run: service-a still breaches, service-b has no data (should auto-resolve)
      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        {
          ...details,
          previousMap: previousAlertsNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should still be in ALERT state (service-a is still alerting)
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // Check alert histories
      alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(4); // 2 from first run + 2 from second run

      // Find the latest histories for each group (groups include multiple fields)
      const serviceAHistories = alertHistories.filter(h =>
        h.group?.includes('service-a'),
      );
      const serviceBHistories = alertHistories.filter(h =>
        h.group?.includes('service-b'),
      );

      // service-a should have 2 histories (both ALERT)
      expect(serviceAHistories.length).toBe(2);
      expect(serviceAHistories[0].state).toBe('ALERT'); // First run
      expect(serviceAHistories[1].state).toBe('ALERT'); // Second run - still alerting
      expect(serviceAHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // service-b should have 2 histories (ALERT -> OK transition due to missing data)
      expect(serviceBHistories.length).toBe(2);
      expect(serviceBHistories[0].state).toBe('ALERT'); // First run
      expect(serviceBHistories[1].state).toBe('OK'); // Second run - auto-resolved due to missing data
      expect(serviceBHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // Check webhook calls:
      // 1-2: First run alerts for service-a and service-b
      // 3: Second run alert for service-a
      // 4: Second run resolution notification for service-b
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(4);

      // Verify the resolution notification was sent for service-b
      const calls = (slack.postMessageToWebhook as jest.Mock).mock.calls;
      const resolutionCall = calls.find(call =>
        call[1].text.includes('My Search'),
      );
      expect(resolutionCall).toBeDefined();
    });

    it('Group-by alerts skip logic - should skip when any group history exists in current window', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });

      // First run at 22:10 (creates history for both service-a and service-b)
      const firstRun = new Date('2023-11-16T22:10:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');

      await bulkInsertLogs([
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-b',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          groupBy: 'ServiceName',
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
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
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // First run - should process and create histories for both groups
      await processAlert(
        firstRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify histories were created for both groups
      let alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(2);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[1].state).toBe('ALERT');
      expect(alertHistories[0].createdAt).toEqual(firstRun);
      expect(alertHistories[1].createdAt).toEqual(firstRun);

      // Second run at 22:12 (WITHIN same 5-minute window as first run at 22:10)
      // Should SKIP because history already exists in this window (22:10-22:15)
      const secondRun = new Date('2023-11-16T22:12:00.000Z');
      const previousAlertsSecondRun = await getPreviousAlertHistories(
        [enhancedAlert.id],
        secondRun,
      );
      await processAlert(
        secondRun,
        {
          ...details,
          previousMap: previousAlertsSecondRun,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify NO new histories were created (still only 2 from first run)
      alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(2); // Still only 2 histories

      // Verify webhooks were only called twice (once per group in first run, not again in second run)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);

      // Third run at 22:16 (NEW window: 22:15-22:20)
      // Should process because we're in a new window
      const thirdRun = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsThirdRun = await getPreviousAlertHistories(
        [enhancedAlert.id],
        thirdRun,
      );
      await processAlert(
        thirdRun,
        {
          ...details,
          previousMap: previousAlertsThirdRun,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify new histories were created (should have 4 now)
      alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(4); // 2 from first run + 2 from third run

      // Verify webhooks were called for the third run
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(4); // 2 from first + 2 from third
    });

    it('Group-by alerts skip logic - should process when no group history exists in current window', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:16:00.000Z'); // Starting in new window
      const eventMs = new Date('2023-11-16T22:10:00.000Z');

      await bulkInsertLogs([
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          groupBy: 'ServiceName',
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
        previousMap: new Map(), // No previous history
      } satisfies AlertDetails;

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      const mockMetadata = {
        getColumn: jest.fn().mockImplementation(({ column }) => {
          const columnMap = {
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // Should process because no previous history exists in this window
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify history was created
      const alertHistories = await AlertHistory.find({
        alert: alert.id,
      });
      expect(alertHistories.length).toBe(1);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // Verify webhook was called
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    });

    it('Group-by alerts skip logic - should skip if ONE group has history in current window (even if other groups do not)', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });

      // First run at 22:10 - only service-a triggers alert
      const firstRun = new Date('2023-11-16T22:10:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');

      await bulkInsertLogs([
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          groupBy: 'ServiceName',
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
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
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // First run - creates history for service-a only
      await processAlert(
        firstRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      let alertHistories = await AlertHistory.find({
        alert: alert.id,
      });
      expect(alertHistories.length).toBe(1);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].createdAt).toEqual(firstRun);

      // Now add logs for service-b (but within the same window)
      await bulkInsertLogs([
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:07:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:07:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
      ]);

      // Second run at 22:12 (WITHIN same window)
      // Should SKIP even though service-b has NEW data that would trigger alert
      // because service-a already has history in this window
      const secondRun = new Date('2023-11-16T22:12:00.000Z');
      const previousAlertsSecondRun = await getPreviousAlertHistories(
        [enhancedAlert.id],
        secondRun,
      );
      await processAlert(
        secondRun,
        {
          ...details,
          previousMap: previousAlertsSecondRun,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify NO new histories were created
      alertHistories = await AlertHistory.find({
        alert: alert.id,
      });
      expect(alertHistories.length).toBe(1); // Still only 1 history from first run

      // Verify webhook was only called once (in first run)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    });

    it('Group-by alerts with mixed transitions (one stays ALERT, one resolves to OK)', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');
      const eventNextMs = new Date('2023-11-16T22:10:00.000Z');

      // Insert logs with different ServiceName values (group-by field)
      await bulkInsertLogs([
        // First window: 22:05 - 22:10 (both service-a and service-b breach threshold)
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-b',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: eventMs,
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        // Second window: 22:10 - 22:15 (service-a still breaches, service-b drops below threshold)
        {
          ServiceName: 'service-a',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        // service-b has data but below threshold (no errors, just info logs)
        {
          ServiceName: 'service-b',
          Timestamp: eventNextMs,
          SeverityText: 'info',
          Body: 'Info from service-b',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          groupBy: 'ServiceName', // Group by ServiceName
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
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
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      // Mock the getMetadata function
      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // First run: should trigger alerts for both service-a and service-b
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should be in ALERT state (because at least one group is alerting)
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // Check that we have 2 alert histories (one for each group)
      let alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(2);

      // Groups can include multiple fields, check that both groups exist
      const groups = alertHistories.map(h => h.group);
      expect(groups.some(g => g?.includes('service-a'))).toBe(true);
      expect(groups.some(g => g?.includes('service-b'))).toBe(true);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[1].state).toBe('ALERT');

      // Second run: service-a still breaches, service-b has data but below threshold (should resolve)
      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        {
          ...details,
          previousMap: previousAlertsNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should still be in ALERT state (service-a is still alerting)
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // Check alert histories
      alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(4); // 2 from first run + 2 from second run

      // Find the latest histories for each group (groups include multiple fields)
      const serviceAHistories = alertHistories.filter(h =>
        h.group?.includes('service-a'),
      );
      const serviceBHistories = alertHistories.filter(h =>
        h.group?.includes('service-b'),
      );

      // service-a should have 2 histories (both ALERT - continues alerting)
      expect(serviceAHistories.length).toBe(2);
      expect(serviceAHistories[0].state).toBe('ALERT'); // First run
      expect(serviceAHistories[1].state).toBe('ALERT'); // Second run - still alerting
      expect(serviceAHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // service-b should have 2 histories (ALERT -> OK transition with data present)
      expect(serviceBHistories.length).toBe(2);
      expect(serviceBHistories[0].state).toBe('ALERT'); // First run
      expect(serviceBHistories[1].state).toBe('OK'); // Second run - resolved (data present but below threshold)
      expect(serviceBHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // Check webhook calls:
      // 1-2: First run alerts for service-a and service-b
      // 3: Second run alert for service-a (continues alerting)
      // 4: Second run resolution notification for service-b
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(4);

      // Verify the resolution notification was sent for service-b
      const calls = (slack.postMessageToWebhook as jest.Mock).mock.calls;
      const resolutionCall = calls.find(call =>
        call[1].text.includes('My Search'),
      );
      expect(resolutionCall).toBeDefined();
    });

    it('TILE alert (metrics) - slack webhook', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:12:00.000Z');
      // Send events in the last alert window 22:05 - 22:10
      const eventMs = now.getTime() - ms('10m');

      const gaugePointsA = [
        { value: 50, timestamp: eventMs },
        { value: 25, timestamp: eventMs + ms('1m') },
        { value: 12.5, timestamp: eventMs + ms('2m') },
        { value: 6.25, timestamp: eventMs + ms('3m') },
      ].map(point => ({
        MetricName: 'test.cpu',
        ServiceName: 'db',
        ResourceAttributes: {
          host: 'host1',
          ip: '127.0.0.1',
        },
        Value: point.value,
        TimeUnix: new Date(point.timestamp),
      }));

      await bulkInsertMetricsGauge(gaugePointsA);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      const source = await Source.create({
        kind: 'metric',
        team: team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          gauge: DEFAULT_METRICS_TABLE.GAUGE,
          histogram: DEFAULT_METRICS_TABLE.HISTOGRAM,
          sum: DEFAULT_METRICS_TABLE.SUM,
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection.id,
        name: 'Metrics',
      });
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        tiles: [
          {
            id: '17quud',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            config: {
              name: 'CPU',
              select: [
                {
                  aggFn: 'max',
                  valueExpression: 'Value',
                  metricType: 'gauge',
                  metricName: 'test.cpu',
                },
              ],
              where: '',
              displayType: 'line',
              source: source.id,
              groupBy: '',
            },
          },
        ],
      }).save();
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
          threshold: 1,
          dashboardId: dashboard.id,
          tileId: '17quud',
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'dashboard',
      ]);

      const tile = dashboard.tiles?.find((t: any) => t.id === '17quud');
      if (!tile)
        throw new Error('tile not found for dashboard metrics webhook');
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
            Value: { name: 'Value', type: 'Double' },
            MetricName: { name: 'MetricName', type: 'String' },
            TimeUnix: { name: 'TimeUnix', type: 'DateTime' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      // Mock the getMetadata function
      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // should fetch 5m of logs
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      const previousAlertsLater = await getPreviousAlertHistories(
        [enhancedAlert.id],
        later,
      );
      await processAlert(
        later,
        {
          ...details,
          previousMap: previousAlertsLater,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      const previousAlertsNextWindow = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        {
          ...details,
          previousMap: previousAlertsNextWindow,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(enhancedAlert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({
        createdAt: 1,
      });

      expect(alertHistories.length).toBe(2);
      const [history1, history2] = alertHistories;
      expect(history1.state).toBe('ALERT');
      expect(history1.counts).toBe(1);
      expect(history1.createdAt).toEqual(new Date('2023-11-16T22:10:00.000Z'));
      expect(history1.lastValues.length).toBe(1);
      expect(history1.lastValues[0].count).toBeGreaterThanOrEqual(1);

      expect(history2.state).toBe('OK');
      expect(history2.counts).toBe(0);
      expect(history2.createdAt).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      // check if webhook was triggered
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "CPU" in "My Dashboard" - 6.25 exceeds 1',
          blocks: [
            {
              text: {
                text: [
                  `*<http://app:8080/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "CPU" in "My Dashboard" - 6.25 exceeds 1>*`,
                  '',
                  '6.25 exceeds 1',
                  'Time Range (UTC): [Nov 16 10:05:00 PM - Nov 16 10:10:00 PM)',
                  '',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );
    });
  });

  describe('getPreviousAlertHistories', () => {
    const server = getServer();

    beforeAll(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.clearDBs();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await server.stop();
    });

    const saveAlert = (id: mongoose.Types.ObjectId, createdAt: Date) => {
      return new AlertHistory({
        alert: id,
        createdAt,
        state: AlertState.OK,
      }).save();
    };

    it('should return the latest alert history for each alert', async () => {
      const alert1Id = new mongoose.Types.ObjectId();
      await saveAlert(alert1Id, new Date('2025-01-01T00:00:00Z'));
      await saveAlert(alert1Id, new Date('2025-01-01T00:05:00Z'));

      const alert2Id = new mongoose.Types.ObjectId();
      await saveAlert(alert2Id, new Date('2025-01-01T00:10:00Z'));
      await saveAlert(alert2Id, new Date('2025-01-01T00:15:00Z'));

      const result = await getPreviousAlertHistories(
        [alert1Id.toString(), alert2Id.toString()],
        new Date('2025-01-01T00:20:00Z'),
      );

      expect(result.size).toBe(2);
      expect(result.get(alert1Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:05:00Z'),
      );
      expect(result.get(alert2Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:15:00Z'),
      );
    });

    it('should not return alert histories from the future', async () => {
      const alert1Id = new mongoose.Types.ObjectId();
      await saveAlert(alert1Id, new Date('2025-01-01T00:00:00Z'));
      await saveAlert(alert1Id, new Date('2025-01-01T00:05:00Z'));

      const alert2Id = new mongoose.Types.ObjectId();
      await saveAlert(alert2Id, new Date('2025-01-01T00:10:00Z'));
      await saveAlert(alert2Id, new Date('2025-01-01T00:15:00Z')); // This one is in the future

      const result = await getPreviousAlertHistories(
        [alert1Id.toString(), alert2Id.toString()],
        new Date('2025-01-01T00:14:00Z'),
      );

      expect(result.size).toBe(2);
      expect(result.get(alert1Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:05:00Z'),
      );
      expect(result.get(alert2Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:10:00Z'),
      );
    });

    it('should not return a history if there are no histories for the given alert', async () => {
      const alert1Id = new mongoose.Types.ObjectId();
      await saveAlert(alert1Id, new Date('2025-01-01T00:00:00Z'));
      await saveAlert(alert1Id, new Date('2025-01-01T00:05:00Z'));

      const alert2Id = new mongoose.Types.ObjectId();

      const result = await getPreviousAlertHistories(
        [alert1Id.toString(), alert2Id.toString()],
        new Date('2025-01-01T00:20:00Z'),
      );

      expect(result.size).toBe(1);
      expect(result.get(alert1Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:05:00Z'),
      );
      expect(result.get(alert2Id.toString())).toBeUndefined();
    });

    it('should not return a history for an alert that is not provided in the argument', async () => {
      const alert1Id = new mongoose.Types.ObjectId();
      await saveAlert(alert1Id, new Date('2025-01-01T00:00:00Z'));
      await saveAlert(alert1Id, new Date('2025-01-01T00:05:00Z'));

      const alert2Id = new mongoose.Types.ObjectId();
      await saveAlert(alert2Id, new Date('2025-01-01T00:10:00Z'));
      await saveAlert(alert2Id, new Date('2025-01-01T00:15:00Z'));

      const result = await getPreviousAlertHistories(
        [alert1Id.toString()],
        new Date('2025-01-01T00:20:00Z'),
      );

      expect(result.size).toBe(1);
      expect(result.get(alert1Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:05:00Z'),
      );
    });

    it('should batch alert IDs across multiple aggregation queries if necessary', async () => {
      const alert1Id = new mongoose.Types.ObjectId();
      await saveAlert(alert1Id, new Date('2025-01-01T00:00:00Z'));
      await saveAlert(alert1Id, new Date('2025-01-01T00:05:00Z'));

      const alert2Id = new mongoose.Types.ObjectId();
      await saveAlert(alert2Id, new Date('2025-01-01T00:10:00Z'));
      await saveAlert(alert2Id, new Date('2025-01-01T00:15:00Z'));

      const aggregateSpy = jest.spyOn(AlertHistory, 'aggregate');

      const result = await getPreviousAlertHistories(
        [
          alert1Id.toString(),
          ...Array(150).fill(new mongoose.Types.ObjectId().toString()),
          alert2Id.toString(),
        ],
        new Date('2025-01-01T00:20:00Z'),
      );

      expect(aggregateSpy).toHaveBeenCalledTimes(4); // 152 ids, batch size 50 => 4 batches
      expect(result.size).toBe(2);
      expect(result.get(alert1Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:05:00Z'),
      );
      expect(result.get(alert2Id.toString())!.createdAt).toEqual(
        new Date('2025-01-01T00:15:00Z'),
      );
    });
  });

  describe('check alerts with multiple time buckets in a single run', () => {
    const server = getServer();

    beforeAll(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.clearDBs();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await server.stop();
    });

    // TODO: revisit this once the auto-resolve feature is implemented
    it('should check 3 time buckets [1 error, 3 errors, 1 error] with threshold 2 and maintain ALERT state with 3 lastValues entries', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:18:00.000Z');

      // Insert logs in 3 time buckets:
      // Bucket 1 (22:00-22:05): 1 error (OK - below threshold of 2)
      // Bucket 2 (22:05-22:10): 3 errors (ALERT - exceeds threshold of 2)
      // Bucket 3 (22:10-22:15): 1 error (OK - below threshold of 2)
      await bulkInsertLogs([
        // Bucket 1: 22:00-22:05 (1 error - below threshold)
        {
          ServiceName: 'api',
          Timestamp: new Date('2023-11-16T22:00:00.000Z'),
          SeverityText: 'error',
          Body: 'Error in bucket 1',
        },
        // Bucket 2: 22:05-22:10 (3 errors - exceeds threshold)
        {
          ServiceName: 'api',
          Timestamp: new Date('2023-11-16T22:05:00.000Z'),
          SeverityText: 'error',
          Body: 'Error 1 in bucket 2',
        },
        {
          ServiceName: 'api',
          Timestamp: new Date('2023-11-16T22:06:00.000Z'),
          SeverityText: 'error',
          Body: 'Error 2 in bucket 2',
        },
        {
          ServiceName: 'api',
          Timestamp: new Date('2023-11-16T22:07:00.000Z'),
          SeverityText: 'error',
          Body: 'Error 3 in bucket 2',
        },
        // Bucket 3: 22:10-22:15 (1 error - below threshold)
        {
          ServiceName: 'api',
          Timestamp: new Date('2023-11-16T22:10:00.000Z'),
          SeverityText: 'error',
          Body: 'Error in bucket 3',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Error Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          // No groupBy - this is a non-group-by alert
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      // Create a previous alert history at 22:00 so the alert job will check data from 22:00 onwards
      // This simulates that the alert was last checked at 22:00
      const previousHistory = await new AlertHistory({
        alert: alert.id,
        createdAt: new Date('2023-11-16T22:00:00.000Z'),
        state: 'OK',
        counts: 0,
        lastValues: [],
      }).save();

      // Load previous alert history for this alert
      const previousMap = await getPreviousAlertHistories(
        [enhancedAlert.id],
        now,
      );

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
        previousMap,
      } satisfies AlertDetails;

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      const mockMetadata = {
        getColumn: jest.fn().mockImplementation(({ column }) => {
          const columnMap = {
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      // Mock the getMetadata function
      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // First run: process alert at 22:18 with timeBucketsToCheckBeforeResolution=3
      // With previous history at 22:00, this should check buckets: 22:00-22:05 (1 error), 22:05-22:10 (3 errors), 22:10-22:15 (1 error)
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because one of the buckets exceeded threshold
      const updatedAlert = await Alert.findById(enhancedAlert.id);
      expect(updatedAlert!.state).toBe('ALERT');

      // Check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1 });

      // Should have 2 alert history entries (1 previous + 1 new)
      expect(alertHistories.length).toBe(2);

      // Get the new alert history (not the previous one we created)
      const history = alertHistories[1];
      expect(history.state).toBe('ALERT');

      // Should have 3 entries in lastValues (one for each time bucket checked)
      // Even though ClickHouse only returns rows with data, the system should populate all 3 buckets
      expect(history.lastValues.length).toBe(3);

      // Verify the lastValues are in chronological order and have correct data
      // The system checks 3 time buckets going back from 'now'
      const buckets = history.lastValues.sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      );

      // Bucket 1 (22:00-22:05): 1 error (below threshold)
      expect(buckets[0].startTime).toEqual(
        new Date('2023-11-16T22:00:00.000Z'),
      );
      expect(buckets[0].count).toBe(1);

      // Bucket 2 (22:05-22:10): 3 errors (exceeds threshold)
      expect(buckets[1].startTime).toEqual(
        new Date('2023-11-16T22:05:00.000Z'),
      );
      expect(buckets[1].count).toBe(3);

      // Bucket 3 (22:10-22:15): 1 error (below threshold)
      expect(buckets[2].startTime).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );
      expect(buckets[2].count).toBe(1);

      // Verify webhook was called for the alert
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);

      // Second run: process alert at 22:22:00
      // Previous history was created at 22:15:00 (from first run)
      // So this should check just ONE new bucket: 22:15-22:20 (0 errors)
      // Since we need to check 3 buckets and only 1 new bucket exists, it will look back at previous buckets:
      // - 22:10-22:15 (1 error - from previous check)
      // - 22:15-22:20 (0 errors - new bucket)
      // With timeBucketsToCheckBeforeResolution=3, the alert should auto-resolve
      const nextRun = new Date('2023-11-16T22:22:00.000Z');
      const previousMapNextRun = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextRun,
      );

      await processAlert(
        nextRun,
        {
          ...details,
          previousMap: previousMapNextRun,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be auto-resolved to OK state
      const resolvedAlert = await Alert.findById(enhancedAlert.id);
      expect(resolvedAlert!.state).toBe('OK');

      // Check alert histories
      const allHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: -1 });

      // Should have 3 alert history entries total (1 previous + 1 ALERT + 1 OK)
      expect(allHistories.length).toBe(3);

      // Verify the resolution history (most recent)
      const resolutionHistory = allHistories[0];
      expect(resolutionHistory.state).toBe('OK');

      // Verify webhook was called twice total (1 for alert + 1 for resolution)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
    });
  });

  describe('group-by alert with disappearing group', () => {
    const server = getServer();

    beforeAll(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.clearDBs();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should use latest createdAt from any group and not rescan old timeframe when one group disappears', async () => {
      jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue(null as any);

      const team = await createTeam({ name: 'My Team' });

      const now = new Date('2023-11-16T22:18:00.000Z');

      // Insert logs in first time bucket (22:00-22:05):
      // - service-a: 3 errors (ALERT - exceeds threshold of 2)
      // - service-b: 3 errors (ALERT - exceeds threshold of 2)
      await bulkInsertLogs([
        {
          ServiceName: 'service-a',
          Timestamp: new Date('2023-11-16T22:00:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: new Date('2023-11-16T22:01:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-a',
          Timestamp: new Date('2023-11-16T22:02:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:00:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:01:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:02:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        // Second time bucket (22:05-22:10):
        // - service-a: 1 error (OK - below threshold)
        // - service-b: 3 errors (ALERT - exceeds threshold)
        {
          ServiceName: 'service-a',
          Timestamp: new Date('2023-11-16T22:05:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:05:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:06:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        {
          ServiceName: 'service-b',
          Timestamp: new Date('2023-11-16T22:07:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-b',
        },
        // Third time bucket (22:10-22:15):
        // - service-a: 1 error (OK - below threshold)
        // - service-b: DISAPPEARS (no logs)
        {
          ServiceName: 'service-a',
          Timestamp: new Date('2023-11-16T22:10:00.000Z'),
          SeverityText: 'error',
          Body: 'Error from service-a',
        },
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const teamWebhooksById = new Map<string, typeof webhook>([
        [webhook._id.toString(), webhook],
      ]);
      const connection = await Connection.create({
        team: team._id,
        name: 'Default',
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
        name: 'Logs',
      });
      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Error Search',
        select: 'Body',
        where: 'SeverityText: "error"',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
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
          groupBy: 'ServiceName', // Group by ServiceName
        },
        mockUserId,
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      // Create previous alert histories at 22:00 for initial baseline (one per service)
      await AlertHistory.create([
        {
          alert: alert.id,
          createdAt: new Date('2023-11-16T22:00:00.000Z'),
          state: 'OK',
          counts: 0,
          lastValues: [],
          group: 'ServiceName:service-a',
        },
        {
          alert: alert.id,
          createdAt: new Date('2023-11-16T22:00:00.000Z'),
          state: 'OK',
          counts: 0,
          lastValues: [],
          group: 'ServiceName:service-b',
        },
      ]);

      const previousMap = await getPreviousAlertHistories(
        [enhancedAlert.id],
        now,
      );

      const details = {
        alert: enhancedAlert,
        source,
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
        previousMap,
      } satisfies AlertDetails;

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      const mockMetadata = {
        getColumn: jest.fn().mockImplementation(({ column }) => {
          const columnMap = {
            Body: { name: 'Body', type: 'String' },
            Timestamp: { name: 'Timestamp', type: 'DateTime' },
            SeverityText: { name: 'SeverityText', type: 'String' },
            ServiceName: { name: 'ServiceName', type: 'String' },
          };
          return Promise.resolve(columnMap[column]);
        }),
      };

      jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
        ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
        getMetadata: jest.fn().mockReturnValue(mockMetadata),
      }));

      // First run: process alert at 22:18
      // Should check buckets: 22:00-22:05, 22:05-22:10, 22:10-22:15
      await processAlert(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state (service-b still alerting)
      const updatedAlert = await Alert.findById(enhancedAlert.id);
      expect(updatedAlert!.state).toBe('ALERT');

      // Check alert histories after first run
      const firstRunHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1 });

      // Should have histories: 1 previous + 2 groups (service-a, service-b)
      // service-a should resolve, service-b should alert
      expect(firstRunHistories.length).toBeGreaterThan(1);

      // Find the latest createdAt from all group histories (should be from 22:15)
      const latestCreatedAt = firstRunHistories
        .slice(1) // Skip the initial previous history
        .reduce(
          (latest, history) => {
            return !latest || history.createdAt > latest
              ? history.createdAt
              : latest;
          },
          null as Date | null,
        );

      expect(latestCreatedAt).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      // Second run: process alert at 22:23:00
      // The check was already done at 22:15 (latest createdAt from any group)
      // Even though service-b doesn't exist in that bucket, we shouldn't recheck old buckets
      // Should use the LATEST createdAt (22:15) from any group, not the earliest
      // This means it should only check NEW bucket: 22:15-22:20
      // Should NOT rescan 22:00-22:05 where service-b had data but was already checked
      const nextRun = new Date('2023-11-16T22:23:00.000Z');
      const previousMapNextRun = await getPreviousAlertHistories(
        [enhancedAlert.id],
        nextRun,
      );

      // Verify that previousMapNextRun has the latest createdAt from any group
      const previousDates = Array.from(previousMapNextRun.values()).map(
        h => h.createdAt,
      );
      const maxPreviousDate = previousDates.reduce(
        (max, date) => (date > max ? date : max),
        new Date(0),
      );
      expect(maxPreviousDate).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      await processAlert(
        nextRun,
        {
          ...details,
          previousMap: previousMapNextRun,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Check all alert histories after second run
      const allHistories = await AlertHistory.find({
        alert: alert.id,
      }).sort({ createdAt: 1 });

      // Verify no histories were created for old timeframes (22:00-22:05)
      // All new histories should have createdAt >= 22:15
      const firstRunEndTime = new Date('2023-11-16T22:15:00.000Z').getTime();
      const newHistories = allHistories.filter(
        h => h.createdAt.getTime() > firstRunEndTime, // Exclude first run histories (which have createdAt <= 22:15)
      );

      // New histories should be for the new bucket (22:20) only
      newHistories.forEach(history => {
        expect(history.createdAt.getTime()).toBeGreaterThanOrEqual(
          new Date('2023-11-16T22:20:00.000Z').getTime(),
        );
      });
    });
  });
});
