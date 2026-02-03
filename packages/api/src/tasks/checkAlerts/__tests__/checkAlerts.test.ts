import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  AlertState,
  Tile,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';

import * as config from '@/config';
import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import {
  bulkInsertData,
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  DEFAULT_DATABASE,
  DEFAULT_METRICS_TABLE,
  getServer,
  getTestFixtureClickHouseClient,
  makeTile,
} from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Connection, { IConnection } from '@/models/connection';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { ISource, Source } from '@/models/source';
import { ITeam } from '@/models/team';
import Webhook, { IWebhook } from '@/models/webhook';
import * as checkAlert from '@/tasks/checkAlerts';
import {
  doesExceedThreshold,
  getPreviousAlertHistories,
  processAlert,
} from '@/tasks/checkAlerts';
import {
  AlertDetails,
  AlertProvider,
  AlertTaskType,
  loadProvider,
} from '@/tasks/checkAlerts/providers';
import {
  AlertMessageTemplateDefaultView,
  buildAlertMessageTemplateHdxLink,
  buildAlertMessageTemplateTitle,
  formatValueToMatchThreshold,
  getDefaultExternalAction,
  isAlertResolved,
  renderAlertTemplate,
  translateExternalActionsToInternal,
} from '@/tasks/checkAlerts/template';
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
    // Create a mock metadata object with the necessary methods
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const mockMetadata = {
      getColumn: jest.fn().mockImplementation(({ column }) => {
        // Provide basic column definitions for common columns to avoid warnings
        const columnMap = {
          Timestamp: { name: 'Timestamp', type: 'DateTime' },
          Body: { name: 'Body', type: 'String' },
          SeverityText: { name: 'SeverityText', type: 'String' },
          ServiceName: { name: 'ServiceName', type: 'String' },
        };
        return Promise.resolve(columnMap[column]);
      }),
      getColumns: jest.fn().mockResolvedValue([]),
      getMapKeys: jest.fn().mockResolvedValue([]),
      getMapValues: jest.fn().mockResolvedValue([]),
      getAllFields: jest.fn().mockResolvedValue([]),
      getTableMetadata: jest.fn().mockResolvedValue({}),
      getClickHouseSettings: jest.fn().mockReturnValue({}),
      setClickHouseSettings: jest.fn(),
      getSkipIndices: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Create a mock clickhouse client
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const mockClickhouseClient = {
      query: jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ data: [] }),
        text: jest.fn().mockResolvedValue(''),
      }),
    } as any;

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

    beforeEach(async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);
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

    it('formatValueToMatchThreshold', () => {
      // Test with integer threshold - value should be formatted as integer
      expect(formatValueToMatchThreshold(1111.11111111, 1)).toBe('1111');
      expect(formatValueToMatchThreshold(5, 1)).toBe('5');
      expect(formatValueToMatchThreshold(5.9, 1)).toBe('6');

      // Test scientific notation threshold - value should be formatted as integer
      expect(formatValueToMatchThreshold(0.00001, 0.0000001)).toBe('0.0000100');

      // Test with single decimal threshold - value should have 1 decimal place
      expect(formatValueToMatchThreshold(1111.11111111, 1.5)).toBe('1111.1');
      expect(formatValueToMatchThreshold(5.555, 1.5)).toBe('5.6');

      // Test with multiple decimal places in threshold
      expect(formatValueToMatchThreshold(1.1234, 0.1234)).toBe('1.1234');
      expect(formatValueToMatchThreshold(5.123456789, 0.1234)).toBe('5.1235');
      expect(formatValueToMatchThreshold(10, 0.12)).toBe('10.00');

      // Test with very long decimal threshold
      expect(formatValueToMatchThreshold(1111.11111111, 0.123456)).toBe(
        '1111.111111',
      );

      // Test edge cases
      expect(formatValueToMatchThreshold(0, 1)).toBe('0');
      expect(formatValueToMatchThreshold(0.5, 1)).toBe('1');
      expect(formatValueToMatchThreshold(0.123456, 0.1234)).toBe('0.1235');

      // Test negative values
      expect(formatValueToMatchThreshold(-5.555, 1.5)).toBe('-5.6');
      expect(formatValueToMatchThreshold(-1111.11111111, 1)).toBe('-1111');

      // Test when value is already an integer and threshold is integer
      expect(formatValueToMatchThreshold(100, 50)).toBe('100');
      expect(formatValueToMatchThreshold(0, 0)).toBe('0');

      // Test rounding behavior
      expect(formatValueToMatchThreshold(1.5, 0.1)).toBe('1.5');
      expect(formatValueToMatchThreshold(1.55, 0.1)).toBe('1.6');
      expect(formatValueToMatchThreshold(1.449, 0.1)).toBe('1.4');

      // Test very large numbers (main benefit of NumberFormat over toFixed)
      expect(formatValueToMatchThreshold(9999999999999.5, 1)).toBe(
        '10000000000000',
      );
      expect(formatValueToMatchThreshold(1234567890123.456, 0.1)).toBe(
        '1234567890123.5',
      );
      expect(formatValueToMatchThreshold(999999999999999, 1)).toBe(
        '999999999999999',
      );

      // Test that thousand separators are NOT added
      expect(formatValueToMatchThreshold(123456.789, 1)).toBe('123457');
      expect(formatValueToMatchThreshold(1000000.5, 0.1)).toBe('1000000.5');

      // Test precision at JavaScript's safe integer boundary
      expect(formatValueToMatchThreshold(9007199254740991, 1)).toBe(
        '9007199254740991',
      );

      // Test very small numbers in different notations
      expect(formatValueToMatchThreshold(0.000000001, 0.0000000001)).toBe(
        '0.0000000010',
      );
      expect(formatValueToMatchThreshold(1.23e-8, 1e-9)).toBe('0.000000012');

      // Test mixed magnitude (large value with small precision threshold)
      expect(formatValueToMatchThreshold(1000000.123456, 0.0001)).toBe(
        '1000000.1235',
      );
      expect(formatValueToMatchThreshold(99999.999999, 0.01)).toBe('100000.00');

      // Test threshold with trailing zeros vs without
      expect(formatValueToMatchThreshold(5.5, 1.0)).toBe('6'); // 1.0 should be treated as integer
      expect(formatValueToMatchThreshold(5.55, 0.1)).toBe('5.6'); // 0.10 has 1 decimal place

      // Test edge case: very small threshold, large value
      expect(formatValueToMatchThreshold(1234567.89, 0.000001)).toBe(
        '1234567.890000',
      );

      // Test rounding at different magnitudes
      expect(formatValueToMatchThreshold(999.9999, 0.001)).toBe('1000.000');
      expect(formatValueToMatchThreshold(0.9999, 0.001)).toBe('1.000');
    });

    it('buildAlertMessageTemplateTitle', () => {
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultSearchView,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"My Search\\" - 10 lines found"`,
      );
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultChartView,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 5 exceeds 1"`,
      );
    });

    it('buildAlertMessageTemplateTitle with state parameter', () => {
      // Test ALERT state (should have 🚨 emoji)
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultSearchView,
          state: AlertState.ALERT,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"My Search\\" - 10 lines found"`,
      );
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultChartView,
          state: AlertState.ALERT,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 5 exceeds 1"`,
      );

      // Test OK state (should have ✅ emoji)
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultSearchView,
          state: AlertState.OK,
        }),
      ).toMatchInlineSnapshot(
        `"✅ Alert for \\"My Search\\" - 10 lines found"`,
      );
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultChartView,
          state: AlertState.OK,
        }),
      ).toMatchInlineSnapshot(
        `"✅ Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 5 exceeds 1"`,
      );
    });

    it('buildAlertMessageTemplateTitle formats value to match threshold precision', () => {
      // Test with decimal threshold - value should be formatted to match
      const decimalChartView: AlertMessageTemplateDefaultView = {
        ...defaultChartView,
        alert: {
          ...defaultChartView.alert,
          threshold: 1.5,
        },
        value: 1111.11111111,
      };

      expect(
        buildAlertMessageTemplateTitle({
          view: decimalChartView,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 1111.1 exceeds 1.5"`,
      );

      // Test with multiple decimal places
      const multiDecimalChartView: AlertMessageTemplateDefaultView = {
        ...defaultChartView,
        alert: {
          ...defaultChartView.alert,
          threshold: 0.1234,
        },
        value: 1.123456789,
      };

      expect(
        buildAlertMessageTemplateTitle({
          view: multiDecimalChartView,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 1.1235 exceeds 0.1234"`,
      );

      // Test with integer value and decimal threshold
      const integerValueView: AlertMessageTemplateDefaultView = {
        ...defaultChartView,
        alert: {
          ...defaultChartView.alert,
          threshold: 0.12,
        },
        value: 10,
      };

      expect(
        buildAlertMessageTemplateTitle({
          view: integerValueView,
        }),
      ).toMatchInlineSnapshot(
        `"🚨 Alert for \\"Test Chart\\" in \\"My Dashboard\\" - 10.00 exceeds 0.12"`,
      );
    });

    it('isAlertResolved', () => {
      // Test OK state returns true
      expect(isAlertResolved(AlertState.OK)).toBe(true);

      // Test ALERT state returns false
      expect(isAlertResolved(AlertState.ALERT)).toBe(false);

      // Test INSUFFICIENT_DATA state returns false
      expect(isAlertResolved(AlertState.INSUFFICIENT_DATA)).toBe(false);

      // Test DISABLED state returns false
      expect(isAlertResolved(AlertState.DISABLED)).toBe(false);
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
      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: mockClickhouseClient,
        metadata: mockMetadata,
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
      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: mockClickhouseClient,
        metadata: mockMetadata,
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
        title: '🚨 Alert for "My Search" - 10 lines found',
        teamWebhooksById: new Map<string, typeof webhook>([
          [webhook._id.toString(), webhook],
        ]),
      });

      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: '🚨 Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | 🚨 Alert for "My Search" - 10 lines found>*',
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
      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: mockClickhouseClient,
        metadata: mockMetadata,
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
        title: '🚨 Alert for "My Search" - 10 lines found',
        teamWebhooksById: new Map<string, typeof webhook>([
          [webhook._id.toString(), webhook],
        ]),
      });

      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: '🚨 Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | 🚨 Alert for "My Search" - 10 lines found>*',
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
        clickhouseClient: mockClickhouseClient,
        metadata: mockMetadata,
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
        title: '🚨 Alert for "My Search" - 10 lines found',
        teamWebhooksById,
      });

      // @webhook should not be called
      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: mockClickhouseClient,
        metadata: mockMetadata,
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
        title: '🚨 Alert for "My Search" - 10 lines found',
        teamWebhooksById,
      });

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
      expect(slack.postMessageToWebhook).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/123',
        {
          text: '🚨 Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | 🚨 Alert for "My Search" - 10 lines found>*',
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
          text: '🚨 Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: [
                  '*<http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false | 🚨 Alert for "My Search" - 10 lines found>*',
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

    it('renderAlertTemplate - resolved alert with simplified message', async () => {
      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        alertProvider,
        clickhouseClient: mockClickhouseClient,
        metadata: mockMetadata,
        state: AlertState.OK, // Resolved state
        template: '@webhook-My_Webhook',
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: null, // using template instead
            },
          },
        },
        title: '✅ Alert for "My Search" - 10 lines found',
        teamWebhooksById: new Map<string, typeof webhook>([
          [webhook._id.toString(), webhook],
        ]),
      });

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
      expect(slack.postMessageToWebhook).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/123',
        {
          text: '✅ Alert for "My Search" - 10 lines found',
          blocks: [
            {
              text: {
                text: expect.stringContaining('The alert has been resolved'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );

      // Verify the message includes the time range but not detailed logs
      const callArgs = (slack.postMessageToWebhook as any).mock.calls[0][1];
      const messageText = callArgs.blocks[0].text.text;
      expect(messageText).toContain('The alert has been resolved');
      expect(messageText).toContain('Time Range (UTC):');
      expect(messageText).toContain('Group: "http"');
      // Should NOT contain detailed log data
      expect(messageText).not.toContain('lines found, expected');
    });
  });

  describe('processAlert', () => {
    const server = getServer();

    beforeAll(async () => {
      await server.start();
    });

    beforeEach(async () => {
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

      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      jest.spyOn(checkAlert, 'handleSendGenericWebhook');
    });

    afterEach(async () => {
      await server.clearDBs();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await server.stop();
    });

    const setupSavedSearchAlertTest = async ({
      webhookSettings,
    }: Partial<{
      webhookSettings: IWebhook;
    }> = {}) => {
      const team = await createTeam({ name: 'My Team' });

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
        ...webhookSettings,
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

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      return {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      };
    };

    const createAlertDetails = async (
      team: ITeam,
      source: ISource,
      alertConfig: Parameters<typeof createAlert>[1],
      additionalDetails:
        | {
            taskType: AlertTaskType.SAVED_SEARCH;
            savedSearch: Omit<ISavedSearch, 'source'>;
          }
        | {
            taskType: AlertTaskType.TILE;
            tile: Tile;
            dashboard: IDashboard;
          },
    ) => {
      const mockUserId = new mongoose.Types.ObjectId();
      const alert = await createAlert(team._id, alertConfig, mockUserId);

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        previousMap: new Map(),
        ...additionalDetails,
      } satisfies AlertDetails;

      return details;
    };

    const processAlertAtTime = async (
      now: Date,
      details: AlertDetails,
      clickhouseClient: ClickhouseClient,
      connection: IConnection,
      alertProvider: AlertProvider,
      teamWebhooksById: Map<string, IWebhook>,
    ) => {
      const previousMap = await getPreviousAlertHistories(
        [details.alert.id],
        now,
      );
      await processAlert(
        now,
        {
          ...details,
          previousMap,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
    };

    it('SAVED_SEARCH alert - slack webhook', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

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

      // should fetch 5m of logs
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlertAtTime(
        later,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlertAtTime(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const nextNextWindow = new Date('2023-11-16T22:20:00.000Z');
      await processAlertAtTime(
        nextNextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
          text: '🚨 Alert for "My Search" - 3 lines found',
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
          text: '🚨 Alert for "My Search" - 1 lines found',
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
      const {
        team,
        webhook,
        connection,
        source,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

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

      const tile = dashboard.tiles?.find((t: any) => t.id === '17quud');
      if (!tile) throw new Error('tile not found for dashboard test case');

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.TILE,
          tile,
          dashboard,
        },
      );

      // should fetch 5m of logs
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlertAtTime(
        later,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlertAtTime(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
          text: '🚨 Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1',
          blocks: [
            {
              text: {
                text: [
                  `*<http://app:8080/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | 🚨 Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1>*`,
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
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(''),
      });
      global.fetch = fetchMock;

      const {
        team,
        webhook,
        connection,
        source,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest({
        webhookSettings: {
          service: WebhookService.Generic,
          url: 'https://webhook.site/123',
          name: 'Generic Webhook',
          description: 'generic webhook description',
          body: JSON.stringify({
            text: '{{link}} | {{title}}',
          }),
          headers: {
            // @ts-expect-error type mismatch due to mongoose typing
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
            Authorization: 'Bearer test-token',
          },
        },
      });

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

      const tile = dashboard.tiles?.find((t: any) => t.id === '17quud');
      if (!tile)
        throw new Error('tile not found for dashboard generic webhook');

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.TILE,
          tile,
          dashboard,
        },
      );

      // should fetch 5m of logs
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlertAtTime(
        later,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlertAtTime(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
          text: `http://app:8080/dashboards/${dashboard.id}?from=1700170200000&granularity=5+minute&to=1700174700000 | 🚨 Alert for "Logs Count" in "My Dashboard" - 3 exceeds 1`,
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer test-token',
        },
      });
    });

    it('Group-by alerts that resolve (missing data case)', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

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

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      // First run: should trigger alerts for both service-a and service-b
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should be in ALERT state (because at least one group is alerting)
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Check that we have 2 alert histories (one for each group)
      let alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      await processAlertAtTime(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should still be in ALERT state (service-a is still alerting)
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Check alert histories
      alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

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

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      // First run - should process and create histories for both groups
      await processAlertAtTime(
        firstRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify histories were created for both groups
      let alertHistories = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(2);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[1].state).toBe('ALERT');
      expect(alertHistories[0].createdAt).toEqual(firstRun);
      expect(alertHistories[1].createdAt).toEqual(firstRun);

      // Second run at 22:12 (WITHIN same 5-minute window as first run at 22:10)
      // Should SKIP because history already exists in this window (22:10-22:15)
      const secondRun = new Date('2023-11-16T22:12:00.000Z');
      await processAlertAtTime(
        secondRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify NO new histories were created (still only 2 from first run)
      alertHistories = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(2); // Still only 2 histories

      // Verify webhooks were only called twice (once per group in first run, not again in second run)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);

      // Third run at 22:16 (NEW window: 22:15-22:20)
      // Should process because we're in a new window
      const thirdRun = new Date('2023-11-16T22:16:00.000Z');
      await processAlertAtTime(
        thirdRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify new histories were created (should have 4 now)
      alertHistories = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1, group: 1 });
      expect(alertHistories.length).toBe(4); // 2 from first run + 2 from third run

      // Verify webhooks were called for the third run
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(4); // 2 from first + 2 from third
    });

    it('Group-by alerts skip logic - should process when no group history exists in current window', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

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

      // Should process because no previous history exists in this window
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify history was created
      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

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

      // First run - creates history for service-a only
      await processAlertAtTime(
        firstRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      let alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      await processAlertAtTime(
        secondRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify NO new histories were created
      alertHistories = await AlertHistory.find({
        alert: details.alert.id,
      });
      expect(alertHistories.length).toBe(1); // Still only 1 history from first run

      // Verify webhook was only called once (in first run)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    });

    it('Group-by alerts with mixed transitions (one stays ALERT, one resolves to OK)', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

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

      // First run: should trigger alerts for both service-a and service-b
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should be in ALERT state (because at least one group is alerting)
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Check that we have 2 alert histories (one for each group)
      let alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      await processAlertAtTime(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Overall alert should still be in ALERT state (service-a is still alerting)
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Check alert histories
      alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      const { team, webhook, connection, teamWebhooksById, clickhouseClient } =
        await setupSavedSearchAlertTest();

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

      const tile = dashboard.tiles?.find((t: any) => t.id === '17quud');
      if (!tile)
        throw new Error('tile not found for dashboard metrics webhook');

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.TILE,
          tile,
          dashboard,
        },
      );

      // should fetch 5m of logs
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlertAtTime(
        later,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should still be in alert state
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlertAtTime(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );
      // alert should be in ok state
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
          text: '🚨 Alert for "CPU" in "My Dashboard" - 6 exceeds 1',
          blocks: [
            {
              text: {
                text: [
                  `*<http://app:8080/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | 🚨 Alert for "CPU" in "My Dashboard" - 6 exceeds 1>*`,
                  '',
                  '6 exceeds 1',
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

    // TODO: revisit this once the auto-resolve feature is implemented
    it('should check 3 time buckets [1 error, 3 errors, 1 error] with threshold 2 and maintain ALERT state with 3 lastValues entries', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

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

      // Create a previous alert history at 22:00 so the alert job will check data from 22:00 onwards
      // This simulates that the alert was last checked at 22:00
      await new AlertHistory({
        alert: details.alert.id,
        createdAt: new Date('2023-11-16T22:00:00.000Z'),
        state: 'OK',
        counts: 0,
        lastValues: [],
      }).save();

      // First run: process alert at 22:18 with timeBucketsToCheckBeforeResolution=3
      // With previous history at 22:00, this should check buckets: 22:00-22:05 (1 error), 22:05-22:10 (3 errors), 22:10-22:15 (1 error)
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because one of the buckets exceeded threshold
      const updatedAlert = await Alert.findById(details.alert.id);
      expect(updatedAlert!.state).toBe('ALERT');

      // Check alert history
      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
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
      await processAlertAtTime(
        nextRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be auto-resolved to OK state
      const resolvedAlert = await Alert.findById(details.alert.id);
      expect(resolvedAlert!.state).toBe('OK');

      // Check alert histories
      const allHistories = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: -1 });

      // Should have 3 alert history entries total (1 previous + 1 ALERT + 1 OK)
      expect(allHistories.length).toBe(3);

      // Verify the resolution history (most recent)
      const resolutionHistory = allHistories[0];
      expect(resolutionHistory.state).toBe('OK');

      // Verify webhook was called twice total (1 for alert + 1 for resolution)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
    });

    it('should use latest createdAt from any group and not rescan old timeframe when one group disappears', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

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

      // Create previous alert histories at 22:00 for initial baseline (one per service)
      await AlertHistory.create([
        {
          alert: details.alert.id,
          createdAt: new Date('2023-11-16T22:00:00.000Z'),
          state: 'OK',
          counts: 0,
          lastValues: [],
          group: 'ServiceName:service-a',
        },
        {
          alert: details.alert.id,
          createdAt: new Date('2023-11-16T22:00:00.000Z'),
          state: 'OK',
          counts: 0,
          lastValues: [],
          group: 'ServiceName:service-b',
        },
      ]);

      // First run: process alert at 22:18
      // Should check buckets: 22:00-22:05, 22:05-22:10, 22:10-22:15
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state (service-b still alerting)
      const updatedAlert = await Alert.findById(details.alert.id);
      expect(updatedAlert!.state).toBe('ALERT');

      // Check alert histories after first run
      const firstRunHistories = await AlertHistory.find({
        alert: details.alert.id,
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
        [details.alert.id],
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

      await processAlertAtTime(
        nextRun,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Check all alert histories after second run
      const allHistories = await AlertHistory.find({
        alert: details.alert.id,
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

    it('should zero-fill periods with no data for non-grouped, BELOW-threshold alerts', async () => {
      // Setup
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
        {
          source: AlertSource.SAVED_SEARCH,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          interval: '5m',
          thresholdType: AlertThresholdType.BELOW,
          threshold: 1,
          savedSearchId: savedSearch.id,
        },
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      const period1Start = new Date('2023-11-16T22:05:00.000Z');
      const period2Start = new Date(period1Start.getTime() + ms('5m'));

      await bulkInsertLogs([
        // Period 1: Logs present
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 2: No logs present (should be zero-filled)
      ]);

      /**
       * Period 1
       */

      const firstRunTime = new Date(period1Start.getTime() + ms('5m'));
      await processAlertAtTime(
        firstRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in OK state because there are two logs in the first period
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // Alert history should reflect 2 logs
      const alertHistoriesPeriod1 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod1.length).toBe(1);
      expect(alertHistoriesPeriod1[0].state).toBe('OK');
      expect(alertHistoriesPeriod1[0].counts).toBe(0);
      expect(alertHistoriesPeriod1[0].lastValues.length).toBe(1);
      expect(alertHistoriesPeriod1[0].lastValues[0].count).toBe(2);
      expect(alertHistoriesPeriod1[0].lastValues[0].startTime).toEqual(
        period1Start,
      );

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(0);

      /**
       * Period 2
       */

      const secondRunTime = new Date(period2Start.getTime() + ms('5m'));
      await processAlertAtTime(
        secondRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because there are no logs in the second period
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Alert history should reflect 0 logs, which is an ALERT
      const alertHistoriesPeriod2 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod2.length).toBe(2);
      expect(alertHistoriesPeriod2[1].state).toBe('ALERT');
      expect(alertHistoriesPeriod2[1].counts).toBe(1);
      expect(alertHistoriesPeriod2[1].lastValues.length).toBe(1);
      expect(alertHistoriesPeriod2[1].lastValues[0].count).toBe(0);
      expect(alertHistoriesPeriod2[1].lastValues[0].startTime).toEqual(
        period2Start,
      );

      // Send alert notification webhook based on the zero-filled period
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    });

    it('should zero-fill periods with no data for non-grouped, BELOW-threshold alerts when run over multiple periods', async () => {
      // Setup
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
        {
          source: AlertSource.SAVED_SEARCH,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          interval: '5m',
          thresholdType: AlertThresholdType.BELOW,
          threshold: 1,
          savedSearchId: savedSearch.id,
        },
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      const period1Start = new Date('2023-11-16T22:05:00.000Z');
      const period2Start = new Date(period1Start.getTime() + ms('5m'));
      const period3Start = new Date(period2Start.getTime() + ms('5m'));

      await bulkInsertLogs([
        // Period 1: Logs present
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 2: No logs present (should be zero-filled)
        // Period 3: Logs present again
        {
          ServiceName: 'api',
          Timestamp: period3Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
      ]);

      /**
       * Period 1
       */

      const firstRunTime = new Date(period1Start.getTime() + ms('5m'));
      await processAlertAtTime(
        firstRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in OK state because there are two logs in the first period
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // Alert history should reflect 2 logs
      const alertHistoriesPeriod1 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod1.length).toBe(1);
      expect(alertHistoriesPeriod1[0].state).toBe('OK');
      expect(alertHistoriesPeriod1[0].counts).toBe(0);
      expect(alertHistoriesPeriod1[0].lastValues.length).toBe(1);
      expect(alertHistoriesPeriod1[0].lastValues[0].count).toBe(2);
      expect(alertHistoriesPeriod1[0].lastValues[0].startTime).toEqual(
        period1Start,
      );

      /**
       * Period 2+3
       */

      const secondRunTime = new Date(period3Start.getTime() + ms('5m'));
      await processAlertAtTime(
        secondRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because there are no logs in the second period
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Alert histories should reflect ALERT state for period 2 and OK state for period 3
      const alertHistoriesPeriod2 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod2).toHaveLength(2);

      expect(alertHistoriesPeriod2[1].state).toBe('ALERT');
      expect(alertHistoriesPeriod2[1].counts).toBe(1);
      expect(alertHistoriesPeriod2[1].lastValues.length).toBe(2);

      // Period 2 - zero-filled
      expect(alertHistoriesPeriod2[1].lastValues[0].count).toBe(0);
      expect(alertHistoriesPeriod2[1].lastValues[0].startTime).toEqual(
        period2Start,
      );

      // Period 3
      expect(alertHistoriesPeriod2[1].lastValues[1].count).toBe(1);
      expect(alertHistoriesPeriod2[1].lastValues[1].startTime).toEqual(
        period3Start,
      );
    });

    it('should auto-resolve ABOVE threshold alerts when zero-filling periods with no data', async () => {
      // Setup
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      const period1Start = new Date('2023-11-16T22:05:00.000Z');
      const period2Start = new Date(period1Start.getTime() + ms('5m'));

      await bulkInsertLogs([
        // Period 1: 2 Logs present, ALERT
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 2: No logs present (should be zero-filled and resolved)
      ]);

      /**
       * Period 1
       */

      const firstRunTime = new Date(period1Start.getTime() + ms('5m'));
      await processAlertAtTime(
        firstRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in OK state because there are two logs in the first period
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // Alert history should reflect 2 logs
      const alertHistoriesPeriod1 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod1.length).toBe(1);
      expect(alertHistoriesPeriod1[0].state).toBe('ALERT');
      expect(alertHistoriesPeriod1[0].counts).toBe(1);
      expect(alertHistoriesPeriod1[0].lastValues.length).toBe(1);
      expect(alertHistoriesPeriod1[0].lastValues[0].count).toBe(2);
      expect(alertHistoriesPeriod1[0].lastValues[0].startTime).toEqual(
        period1Start,
      );

      /**
       * Period 2
       */

      const secondRunTime = new Date(period2Start.getTime() + ms('5m'));
      await processAlertAtTime(
        secondRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in OK state because there are no logs in the second period
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // Alert histories should reflect OK state for period 2
      const alertHistoriesPeriod2 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod2).toHaveLength(2);

      expect(alertHistoriesPeriod2[1].state).toBe('OK');
      expect(alertHistoriesPeriod2[1].counts).toBe(0);
      expect(alertHistoriesPeriod2[1].lastValues.length).toBe(1);

      // Period 2 - zero-filled
      expect(alertHistoriesPeriod2[1].lastValues[0].count).toBe(0);
      expect(alertHistoriesPeriod2[1].lastValues[0].startTime).toEqual(
        period2Start,
      );

      // Verify that resolve webhook was called for the alert, then called for the resolution
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
    });

    it('should auto-resolve ABOVE-threshold, grouped alerts based on zero-filled periods', async () => {
      // Setup
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
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
          groupBy: 'ServiceName',
        },
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      const period1Start = new Date('2023-11-16T22:05:00.000Z');
      const period2Start = new Date(period1Start.getTime() + ms('5m'));
      const period3Start = new Date(period2Start.getTime() + ms('5m'));

      await bulkInsertLogs([
        // Period 1: api service is in alarm, app service is not
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'app',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 2: app service is in alarm, api service alert is auto-resolved
        {
          ServiceName: 'app',
          Timestamp: period2Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'app',
          Timestamp: period2Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 3: no logs at all, app alarm is also auto-resolved
      ]);

      /**
       * Period 1
       */

      const firstRunTime = new Date(period1Start.getTime() + ms('5m'));
      await processAlertAtTime(
        firstRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because the api service has 2 error logs
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // 2 alert histories, one for api (ALERT) and one for app (OK)
      const alertHistoriesPeriod1 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod1).toHaveLength(2);

      // api
      const apiAlertHistory = alertHistoriesPeriod1.find(
        ({ group }) => group === 'ServiceName:api',
      );
      expect(apiAlertHistory?.state).toBe('ALERT');
      expect(apiAlertHistory?.counts).toBe(1);
      expect(apiAlertHistory?.lastValues.length).toBe(1);
      expect(apiAlertHistory?.lastValues[0].count).toBe(2);
      expect(apiAlertHistory?.lastValues[0].startTime).toEqual(period1Start);

      // app
      const appAlertHistory = alertHistoriesPeriod1.find(
        ({ group }) => group === 'ServiceName:app',
      );
      expect(appAlertHistory?.state).toBe('OK');
      expect(appAlertHistory?.counts).toBe(0);
      expect(appAlertHistory?.lastValues.length).toBe(1);
      expect(appAlertHistory?.lastValues[0].count).toBe(1);
      expect(appAlertHistory?.lastValues[0].startTime).toEqual(period1Start);

      // Verify that webhook was called for the alert
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
      jest.mocked(slack.postMessageToWebhook).mockReset();

      /**
       * Period 2
       */

      const secondRunTime = new Date(period2Start.getTime() + ms('5m'));
      await processAlertAtTime(
        secondRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because now the app service is in alarm
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // 4 alert histories, 2 for api (ALERT, OK) and 2 for app (OK, ALERT)
      const alertHistoriesPeriod2 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod2).toHaveLength(4);

      // api - should be zero-filled
      const apiAlertHistory2 = alertHistoriesPeriod2.filter(
        ({ group }) => group === 'ServiceName:api',
      )[1];
      expect(apiAlertHistory2?.state).toBe('OK');
      expect(apiAlertHistory2?.counts).toBe(0);
      expect(apiAlertHistory2?.lastValues.length).toBe(1);
      expect(apiAlertHistory2?.lastValues[0].count).toBe(0);
      expect(apiAlertHistory2?.lastValues[0].startTime).toEqual(period2Start);

      // app
      const appAlertHistory2 = alertHistoriesPeriod2.filter(
        ({ group }) => group === 'ServiceName:app',
      )[1];
      expect(appAlertHistory2?.state).toBe('ALERT');
      expect(appAlertHistory2?.counts).toBe(1);
      expect(appAlertHistory2?.lastValues.length).toBe(1);
      expect(appAlertHistory2?.lastValues[0].count).toBe(2);
      expect(appAlertHistory2?.lastValues[0].startTime).toEqual(period2Start);

      // Verify that resolve webhook was called for the alert (app) and for the called for the resolution (api)
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
      jest.mocked(slack.postMessageToWebhook).mockReset();

      /**
       * Period 3 - api is still OK, app should be auto-resolved
       */
      const thirdRunTime = new Date(period3Start.getTime() + ms('5m'));
      await processAlertAtTime(
        thirdRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in OK state since app should have been resolved
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // 5 alert histories, 2 for api (ALERT, OK, <nothing for period 3>) and 3 for app (OK, ALERT, OK)
      const alertHistoriesPeriod3 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod3).toHaveLength(5);

      // api - should not have any new alert histories in this period
      const apiAlertHistory3 = alertHistoriesPeriod3.filter(
        ({ group }) => group === 'ServiceName:api',
      );
      expect(apiAlertHistory3).toHaveLength(2);

      // app - should have an auto-resolve alert history
      const appAlertHistory3 = alertHistoriesPeriod3.filter(
        ({ group }) => group === 'ServiceName:app',
      );
      expect(appAlertHistory3).toHaveLength(3);
      expect(appAlertHistory3[2].state).toBe('OK');
      expect(appAlertHistory3[2].counts).toBe(0);
      expect(appAlertHistory3[2].lastValues.length).toBe(1);
      expect(appAlertHistory3[2].lastValues[0].count).toBe(0);
      expect(appAlertHistory3[2].lastValues[0].startTime).toEqual(period3Start);

      // Verify that resolve webhook was called for the resolution of the previous api alert
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    });

    it('should not ALERT for a grouped alert based on zero-filled data if there are some groups in the period', async () => {
      // Setup
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
        {
          source: AlertSource.SAVED_SEARCH,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          interval: '5m',
          thresholdType: AlertThresholdType.BELOW,
          threshold: 1,
          savedSearchId: savedSearch.id,
          groupBy: 'ServiceName',
        },
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      const period1Start = new Date('2023-11-16T22:05:00.000Z');
      const period2Start = new Date(period1Start.getTime() + ms('5m'));

      await bulkInsertLogs([
        // Period 1: two groups, neither are in alarm
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'app',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 2: Logs for api, not for app.
        {
          ServiceName: 'api',
          Timestamp: period2Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
      ]);

      /**
       * Period 1
       */

      const firstRunTime = new Date(period1Start.getTime() + ms('5m'));
      await processAlertAtTime(
        firstRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because the api service has 2 error logs
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // 2 alert histories, one for api (OK) and one for app (OK)
      const alertHistoriesPeriod1 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod1).toHaveLength(2);

      // api
      const apiAlertHistory = alertHistoriesPeriod1.find(
        ({ group }) => group === 'ServiceName:api',
      );
      expect(apiAlertHistory?.state).toBe('OK');
      expect(apiAlertHistory?.counts).toBe(0);
      expect(apiAlertHistory?.lastValues.length).toBe(1);
      expect(apiAlertHistory?.lastValues[0].count).toBe(1);
      expect(apiAlertHistory?.lastValues[0].startTime).toEqual(period1Start);

      // app
      const appAlertHistory = alertHistoriesPeriod1.find(
        ({ group }) => group === 'ServiceName:app',
      );
      expect(appAlertHistory?.state).toBe('OK');
      expect(appAlertHistory?.counts).toBe(0);
      expect(appAlertHistory?.lastValues.length).toBe(1);
      expect(appAlertHistory?.lastValues[0].count).toBe(1);
      expect(appAlertHistory?.lastValues[0].startTime).toEqual(period1Start);

      // Verify that webhook was not called for the alert
      expect(slack.postMessageToWebhook).not.toHaveBeenCalled();

      /**
       * Period 2 - 1 log for api (OK), no logs for app (no alert, because we don't zero-fill)
       */

      const secondRunTime = new Date(period2Start.getTime() + ms('5m'));
      await processAlertAtTime(
        secondRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in OK state because grouped alerts do not alert due to zero-fill
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // 3 alert histories. 2 for api (OK, OK) and 1 for app (OK)
      const alertHistoriesPeriod2 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod2).toHaveLength(3);

      expect(alertHistoriesPeriod2[2].state).toBe('OK');
      expect(alertHistoriesPeriod2[2].group).toBe('ServiceName:api');

      // Verify that webhook was not called for the alert
      expect(slack.postMessageToWebhook).not.toHaveBeenCalled();
    });

    it('should ALERT for a grouped alert based on zero-filled data if there is no data for any group in the period', async () => {
      // Setup
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const details = await createAlertDetails(
        team,
        source,
        {
          source: AlertSource.SAVED_SEARCH,
          channel: {
            type: 'webhook',
            webhookId: webhook._id.toString(),
          },
          interval: '5m',
          thresholdType: AlertThresholdType.BELOW,
          threshold: 1,
          savedSearchId: savedSearch.id,
          groupBy: 'ServiceName',
        },
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      const period1Start = new Date('2023-11-16T22:05:00.000Z');
      const period2Start = new Date(period1Start.getTime() + ms('5m'));

      await bulkInsertLogs([
        // Period 1: two groups, neither are in alarm
        {
          ServiceName: 'api',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'app',
          Timestamp: period1Start,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        // Period 2: No logs for either group
      ]);

      /**
       * Period 1
       */

      const firstRunTime = new Date(period1Start.getTime() + ms('5m'));
      await processAlertAtTime(
        firstRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because the api service has 2 error logs
      expect((await Alert.findById(details.alert.id))!.state).toBe('OK');

      // 2 alert histories, one for api (OK) and one for app (OK)
      const alertHistoriesPeriod1 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod1).toHaveLength(2);

      // api
      const apiAlertHistory = alertHistoriesPeriod1.find(
        ({ group }) => group === 'ServiceName:api',
      );
      expect(apiAlertHistory?.state).toBe('OK');
      expect(apiAlertHistory?.counts).toBe(0);
      expect(apiAlertHistory?.lastValues.length).toBe(1);
      expect(apiAlertHistory?.lastValues[0].count).toBe(1);
      expect(apiAlertHistory?.lastValues[0].startTime).toEqual(period1Start);

      // app
      const appAlertHistory = alertHistoriesPeriod1.find(
        ({ group }) => group === 'ServiceName:app',
      );
      expect(appAlertHistory?.state).toBe('OK');
      expect(appAlertHistory?.counts).toBe(0);
      expect(appAlertHistory?.lastValues.length).toBe(1);
      expect(appAlertHistory?.lastValues[0].count).toBe(1);
      expect(appAlertHistory?.lastValues[0].startTime).toEqual(period1Start);

      // Verify that webhook was not called for the alert
      expect(slack.postMessageToWebhook).not.toHaveBeenCalled();

      /**
       * Period 2 - no data for either group
       */

      const secondRunTime = new Date(period2Start.getTime() + ms('5m'));
      await processAlertAtTime(
        secondRunTime,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Alert should be in ALERT state because there is no data and the period is zero-filled
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      // 3 alert histories. The newest one should have an empty group and be in ALERT state
      const alertHistoriesPeriod2 = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({ createdAt: 1 });
      expect(alertHistoriesPeriod2).toHaveLength(3);

      expect(alertHistoriesPeriod2[2].state).toBe('ALERT');
      expect(alertHistoriesPeriod2[2].group).toBeUndefined();

      // Verify that webhook was called for the alert
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
    });

    it('should not fire notifications when alert is silenced', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');

      await bulkInsertLogs([
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
      ]);

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      // Silence the alert until 1 hour from now
      const alertDoc = await Alert.findById(details.alert.id);
      alertDoc!.silenced = {
        at: new Date(),
        until: new Date(Date.now() + 3600000), // 1 hour from now
      };
      await alertDoc!.save();

      // Update the details.alert object to reflect the silenced state
      // (simulates what would happen if the alert was silenced before task queuing)
      details.alert.silenced = alertDoc!.silenced;

      // Process the alert - should skip firing because it's silenced
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify webhook was NOT called
      expect(slack.postMessageToWebhook).not.toHaveBeenCalled();

      // Verify alert state was still updated
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');
    });

    it('should fire notifications when silenced period has expired', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');

      await bulkInsertLogs([
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
      ]);

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      // Silence the alert but set expiry to the past
      const alertDoc = await Alert.findById(details.alert.id);
      alertDoc!.silenced = {
        at: new Date(Date.now() - 7200000), // 2 hours ago
        until: new Date(Date.now() - 3600000), // 1 hour ago (expired)
      };
      await alertDoc!.save();

      // Update the details.alert object to reflect the expired silenced state
      details.alert.silenced = alertDoc!.silenced;

      // Process the alert - should fire because silence has expired
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify webhook WAS called
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');
    });

    it('should fire notifications when alert is unsilenced', async () => {
      const {
        team,
        webhook,
        connection,
        source,
        savedSearch,
        teamWebhooksById,
        clickhouseClient,
      } = await setupSavedSearchAlertTest();

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');

      await bulkInsertLogs([
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
      ]);

      const details = await createAlertDetails(
        team,
        source,
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
        {
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
        },
      );

      // Alert is unsilenced (no silenced field)
      const alertDoc = await Alert.findById(details.alert.id);
      alertDoc!.silenced = undefined;
      await alertDoc!.save();

      // Update the details.alert object to reflect the unsilenced state
      details.alert.silenced = undefined;

      // Process the alert - should fire normally
      await processAlertAtTime(
        now,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Verify webhook WAS called
      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(1);
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');
    });
  });

  describe('processAlert with materialized views', () => {
    const MV_TABLE_NAME = 'otel_logs_rollup_5m';
    const server = getServer();

    const createMV = async () => {
      const client = await getTestFixtureClickHouseClient();
      await client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${DEFAULT_DATABASE}.${MV_TABLE_NAME}
          (
              Timestamp DateTime,
              ServiceName LowCardinality(String),
              SeverityText LowCardinality(String),
              count SimpleAggregateFunction(sum, UInt64)
          )
          ENGINE = AggregatingMergeTree
          PARTITION BY toDate(Timestamp)
          ORDER BY (ServiceName, SeverityText, Timestamp)
          SETTINGS index_granularity = 8192
        `,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
    };

    const clearMV = async () => {
      const client = await getTestFixtureClickHouseClient();
      await client.command({
        query: `TRUNCATE ${DEFAULT_DATABASE}.${MV_TABLE_NAME}`,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
    };

    const createSavedSearchWithMVSource = async (savedSearchWhere: string) => {
      const team = await createTeam({ name: 'My Team' });
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
        materializedViews: [
          {
            databaseName: DEFAULT_DATABASE,
            tableName: MV_TABLE_NAME,
            dimensionColumns: 'ServiceName, SeverityText',
            minGranularity: '5 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              {
                sourceColumn: '',
                aggFn: 'count',
                mvColumn: 'count',
              },
            ],
          },
        ],
      });

      const savedSearch = await new SavedSearch({
        team: team._id,
        name: 'My Search',
        select: 'Body',
        where: savedSearchWhere,
        whereLanguage: 'lucene',
        orderBy: 'Timestamp',
        source: source.id,
        tags: ['test'],
      }).save();

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      return {
        team,
        clickhouseClient,
        webhook,
        savedSearch,
        source,
        connection,
        teamWebhooksById,
      };
    };

    beforeAll(async () => {
      await server.start();
      await createMV();
    });

    beforeEach(async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce({ text: 'ok' });

      jest.spyOn(checkAlert, 'handleSendGenericWebhook');
    });

    afterEach(async () => {
      await server.clearDBs();
      await clearMV();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      const client = await getTestFixtureClickHouseClient();
      await client.command({
        query: `DROP TABLE IF EXISTS ${DEFAULT_DATABASE}.${MV_TABLE_NAME}`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      await server.stop();
    });

    it('should process alerts using materialized views when a compatible materialized view is available', async () => {
      // Arrange
      const {
        team,
        clickhouseClient,
        webhook,
        savedSearch,
        source,
        connection,
        teamWebhooksById,
      } = await createSavedSearchWithMVSource('SeverityText:"error"');

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
        new mongoose.Types.ObjectId(),
      );

      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);

      const details = {
        alert: enhancedAlert,
        source,
        previousMap: new Map(),
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
      } satisfies AlertDetails;

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');
      const eventNextMs = new Date('2023-11-16T22:10:00.000Z');

      // Insert directly into the MV so that we can be sure the MV is being used
      await bulkInsertData(`${DEFAULT_DATABASE}.${MV_TABLE_NAME}`, [
        // logs from 22:05 - 22:10
        {
          ServiceName: 'api',
          Timestamp: eventMs,
          SeverityText: 'error',
          count: 3,
        },
        // logs from 22:10 - 22:15
        {
          ServiceName: 'api',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          count: 1,
        },
        {
          ServiceName: 'api',
          Timestamp: eventNextMs,
          SeverityText: 'info',
          count: 2,
        },
      ]);

      // Act - Run alerts twice to cover two periods
      let previousMap = await getPreviousAlertHistories(
        [details.alert.id],
        now,
      );
      await processAlert(
        now,
        {
          ...details,
          previousMap,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      const nextWindow = new Date('2023-11-16T22:15:00.000Z');
      previousMap = await getPreviousAlertHistories(
        [details.alert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Assert - Alert ran and has a state consistent with the data in the MV
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(2);

      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].lastValues[0].count).toBe(3);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );

      expect(alertHistories[1].state).toBe('ALERT');
      expect(alertHistories[1].counts).toBe(1);
      expect(alertHistories[1].lastValues[0].count).toBe(1);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );
    });

    it('should not use a materialized view when the query is incompatible with the available materialized view', async () => {
      // Arrange
      const {
        team,
        clickhouseClient,
        webhook,
        savedSearch,
        source,
        connection,
        teamWebhooksById,
      } = await createSavedSearchWithMVSource('Body:no'); // Body is not in the MV, so the MV should not be used

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
        previousMap: new Map(),
        taskType: AlertTaskType.SAVED_SEARCH,
        savedSearch,
      } satisfies AlertDetails;

      const now = new Date('2023-11-16T22:12:00.000Z');
      const eventMs = new Date('2023-11-16T22:05:00.000Z');
      const eventNextMs = new Date('2023-11-16T22:10:00.000Z');

      // Insert directly into the MV so that we can be sure the MV is being used
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
        {
          ServiceName: 'api',
          Timestamp: eventNextMs,
          SeverityText: 'error',
          Body: 'Oh no! Something went wrong!',
        },
        {
          ServiceName: 'api',
          Timestamp: eventNextMs,
          SeverityText: 'info',
          Body: 'Something went right for a change!',
        },
      ]);

      // Act - Run alerts twice to cover two periods
      let previousMap = await getPreviousAlertHistories(
        [details.alert.id],
        now,
      );
      await processAlert(
        now,
        {
          ...details,
          previousMap,
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      const nextWindow = new Date('2023-11-16T22:15:00.000Z');
      previousMap = await getPreviousAlertHistories(
        [details.alert.id],
        nextWindow,
      );
      await processAlert(
        nextWindow,
        details,
        clickhouseClient,
        connection.id,
        alertProvider,
        teamWebhooksById,
      );

      // Assert - Alert ran and has a state consistent with the data in the base table
      expect((await Alert.findById(details.alert.id))!.state).toBe('ALERT');

      const alertHistories = await AlertHistory.find({
        alert: details.alert.id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(2);

      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].lastValues[0].count).toBe(3);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );

      expect(alertHistories[1].state).toBe('ALERT');
      expect(alertHistories[1].counts).toBe(1);
      expect(alertHistories[1].lastValues[0].count).toBe(2);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
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
});
