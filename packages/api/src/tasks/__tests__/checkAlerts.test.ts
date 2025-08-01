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
  buildChartLink,
  buildLogSearchLink,
  doesExceedThreshold,
  processAlert,
} from '@/tasks/checkAlerts';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateHdxLink,
  buildAlertMessageTemplateTitle,
  getDefaultExternalAction,
  renderAlertTemplate,
  translateExternalActionsToInternal,
} from '@/tasks/template';
import * as slack from '@/utils/slack';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  tiles: [makeTile(), makeTile()],
  tags: ['test'],
};

const MOCK_SOURCE = {};

const MOCK_SAVED_SEARCH: any = {
  id: 'fake-saved-search-id',
};

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

  describe('buildLogSearchLink', () => {
    it('should build correct URL with basic parameters', () => {
      const result = buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toBe(
        'http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false',
      );
    });

    it('should handle different saved search IDs', () => {
      const customSavedSearch: any = {
        id: 'custom-search-123',
        _id: new mongoose.Types.ObjectId(),
        team: new mongoose.Types.ObjectId(),
        source: new mongoose.Types.ObjectId(),
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        tags: ['test'],
      };
      const result = buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: customSavedSearch,
      });

      expect(result).toContain('/search/custom-search-123?');
      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091239103');
      expect(result).toContain('isLive=false');
    });

    it('should handle different date ranges', () => {
      const result = buildLogSearchLink({
        startTime: new Date('2024-01-01T00:00:00.000Z'),
        endTime: new Date('2024-01-01T23:59:59.999Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('/search/fake-saved-search-id?');
      expect(result).toContain('from=1704067200000');
      expect(result).toContain('to=1704153599999');
      expect(result).toContain('isLive=false');
    });

    it('should handle very close dates', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:03.104Z'); // 1ms difference

      const result = buildLogSearchLink({
        startTime,
        endTime,
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091183104');
      expect(result).toContain('isLive=false');
    });

    it('should handle same start and end time', () => {
      const sameTime = new Date('2023-03-17T22:13:03.103Z');

      const result = buildLogSearchLink({
        startTime: sameTime,
        endTime: sameTime,
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091183103');
      expect(result).toContain('isLive=false');
    });

    it('should handle saved search ID with special characters', () => {
      const specialSavedSearch: any = {
        id: 'search-with-special-chars-123_456',
        _id: new mongoose.Types.ObjectId(),
        team: new mongoose.Types.ObjectId(),
        source: new mongoose.Types.ObjectId(),
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        tags: ['test'],
      };
      const result = buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: specialSavedSearch,
      });

      expect(result).toContain('/search/search-with-special-chars-123_456?');
    });

    it('should always include isLive=false parameter', () => {
      const result = buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('isLive=false');
    });

    it('should generate valid URL structure', () => {
      const result = buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();

      const url = new URL(result);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('app');
      expect(url.port).toBe('8080');
      expect(url.pathname).toBe('/search/fake-saved-search-id');

      const params = url.searchParams;
      expect(params.get('from')).toBe('1679091183103');
      expect(params.get('to')).toBe('1679091239103');
      expect(params.get('isLive')).toBe('false');
    });
  });

  describe('buildChartLink', () => {
    it('should build correct URL with basic parameters', () => {
      const result = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      // Should contain dashboard ID in path
      expect(result).toContain('/dashboards/dashboard-123?');

      // Should have from, to, and granularity parameters
      expect(result).toContain('from=');
      expect(result).toContain('to=');
      expect(result).toContain('granularity=');
    });

    it('should extend time range by 7x granularity', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:59.103Z');
      const granularity = '5m';

      const result = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity,
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // 5 minutes = 5 * 60 * 1000 = 300000ms
      // 7x granularity = 7 * 300000 = 2100000ms
      const expectedFrom = startTime.getTime() - 2100000;
      const expectedTo = endTime.getTime() + 2100000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });

    it('should handle different granularities', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:59.103Z');

      // Test 1 minute granularity
      const result1m = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '1m',
      });

      const url1m = new URL(result1m);
      const from1m = parseInt(url1m.searchParams.get('from') || '0');
      const to1m = parseInt(url1m.searchParams.get('to') || '0');

      // 1 minute = 1 * 60 * 1000 = 60000ms
      // 7x granularity = 7 * 60000 = 420000ms
      expect(from1m).toBe(startTime.getTime() - 420000);
      expect(to1m).toBe(endTime.getTime() + 420000);

      // Test 1 hour granularity
      const result1h = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '1h',
      });

      const url1h = new URL(result1h);
      const from1h = parseInt(url1h.searchParams.get('from') || '0');
      const to1h = parseInt(url1h.searchParams.get('to') || '0');

      // 1 hour = 1 * 60 * 60 * 1000 = 3600000ms
      // 7x granularity = 7 * 3600000 = 25200000ms
      expect(from1h).toBe(startTime.getTime() - 25200000);
      expect(to1h).toBe(endTime.getTime() + 25200000);
    });

    it('should handle different dashboard IDs', () => {
      const result = buildChartLink({
        dashboardId: 'custom-dashboard-456',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      expect(result).toContain('/dashboards/custom-dashboard-456?');
    });

    it('should handle dashboard ID with special characters', () => {
      const result = buildChartLink({
        dashboardId: 'dashboard-with-special-chars_123-456',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      expect(result).toContain(
        '/dashboards/dashboard-with-special-chars_123-456?',
      );
    });

    it('should generate valid URL structure', () => {
      const result = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();

      const url = new URL(result);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('app');
      expect(url.port).toBe('8080');
      expect(url.pathname).toBe('/dashboards/dashboard-123');

      const params = url.searchParams;
      expect(params.has('from')).toBe(true);
      expect(params.has('to')).toBe(true);
      expect(params.has('granularity')).toBe(true);
    });

    it('should handle very close dates', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:03.104Z'); // 1ms difference

      const result = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '5m',
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // Should still extend by 7x granularity even for very close dates
      const expectedFrom = startTime.getTime() - 7 * 5 * 60 * 1000;
      const expectedTo = endTime.getTime() + 7 * 5 * 60 * 1000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });

    it('should handle same start and end time', () => {
      const sameTime = new Date('2023-03-17T22:13:03.103Z');

      const result = buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: sameTime,
        endTime: sameTime,
        granularity: '5m',
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // Should still extend by 7x granularity
      const expectedFrom = sameTime.getTime() - 7 * 5 * 60 * 1000;
      const expectedTo = sameTime.getTime() + 7 * 5 * 60 * 1000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
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
      },
      dashboard: {
        _id: new mongoose.Types.ObjectId(),
        id: 'id-123',
        name: 'My Dashboard',
        tiles: [makeTile()],
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
        buildAlertMessageTemplateHdxLink(defaultSearchView),
      ).toMatchInlineSnapshot(
        `"http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false"`,
      );
      expect(
        buildAlertMessageTemplateHdxLink(defaultChartView),
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
        clickhouseClient: {} as any,
        metadata: {} as any,
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
        team: {
          id: team._id.toString(),
        },
      });

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
      // TODO: test call arguments
    });

    it('renderAlertTemplate - custom body with single action', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const team = await createTeam({ name: 'My Team' });
      await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        clickhouseClient: {} as any,
        metadata: {} as any,
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
        team: {
          id: team._id.toString(),
        },
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
      await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        clickhouseClient: {} as any,
        metadata: {} as any,
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
        team: {
          id: team._id.toString(),
        },
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
      await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();
      await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/456',
        name: 'Another_Webhook',
      }).save();

      await renderAlertTemplate({
        clickhouseClient: {} as any,
        metadata: {} as any,
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
        team: {
          id: team._id.toString(),
        },
      });

      // @webhook should not be called
      await renderAlertTemplate({
        clickhouseClient: {} as any,
        metadata: {} as any,
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
        team: {
          id: team._id.toString(),
        },
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
      });

      const enhancedAlert: any = await Alert.findById(alert._id).populate([
        'team',
        'savedSearch',
      ]);

      // should fetch 5m of logs
      await processAlert(now, enhancedAlert);
      expect(enhancedAlert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, enhancedAlert);
      // alert should still be in alert state
      expect(enhancedAlert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, enhancedAlert);
      // alert should be in ok state
      expect(enhancedAlert.state).toBe('ALERT');

      const nextNextWindow = new Date('2023-11-16T22:20:00.000Z');
      await processAlert(nextNextWindow, enhancedAlert);
      // alert should be in ok state
      expect(enhancedAlert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
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
      const alert = await createAlert(team._id, {
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
      });

      const enhancedAlert: any = await Alert.findById(alert._id).populate([
        'team',
        'dashboard',
      ]);

      // should fetch 5m of logs
      await processAlert(now, enhancedAlert);
      expect(enhancedAlert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, enhancedAlert);
      // alert should still be in alert state
      expect(enhancedAlert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, enhancedAlert);
      // alert should be in ok state
      expect(enhancedAlert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
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

      const fetchMock = jest.fn().mockResolvedValue({});
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
        headers: { 'Content-Type': 'application/json' },
      }).save();
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
      const alert = await createAlert(team._id, {
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
      });

      const enhancedAlert: any = await Alert.findById(alert._id).populate([
        'team',
        'dashboard',
      ]);

      // should fetch 5m of logs
      await processAlert(now, enhancedAlert);
      expect(enhancedAlert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, enhancedAlert);
      // alert should still be in alert state
      expect(enhancedAlert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, enhancedAlert);
      // alert should be in ok state
      expect(enhancedAlert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
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

      // check if generic webhook was triggered, injected, and parsed, and sent correctly
      expect(fetchMock).toHaveBeenCalledWith('https://webhook.site/123', {
        method: 'POST',
        body: JSON.stringify({
          text: `http://app:8080/dashboards/${dashboard.id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1`,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
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
      const alert = await createAlert(team._id, {
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
      });

      const enhancedAlert: any = await Alert.findById(alert._id).populate([
        'team',
        'dashboard',
      ]);

      // should fetch 5m of logs
      await processAlert(now, enhancedAlert);
      expect(enhancedAlert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, enhancedAlert);
      // alert should still be in alert state
      expect(enhancedAlert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, enhancedAlert);
      // alert should be in ok state
      expect(enhancedAlert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
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
});
