import ms from 'ms';

import {
  buildMetricSeries,
  generateBuildTeamEventFn,
  getServer,
  mockLogsPropertyTypeMappingsModel,
  mockSpyMetricPropertyTypeMappingsModel,
} from '@/fixtures';
import { LogType } from '@/utils/logParser';

import * as clickhouse from '../../clickhouse';
import { createAlert } from '../../controllers/alerts';
import { createTeam } from '../../controllers/team';
import AlertHistory from '../../models/alertHistory';
import Dashboard from '../../models/dashboard';
import LogView from '../../models/logView';
import Webhook from '../../models/webhook';
import * as slack from '../../utils/slack';
import * as checkAlert from '../checkAlerts';
import {
  buildAlertMessageTemplateHdxLink,
  buildAlertMessageTemplateTitle,
  buildLogSearchLink,
  doesExceedThreshold,
  expandToNestedObject,
  getDefaultExternalAction,
  processAlert,
  renderAlertTemplate,
  roundDownToXMinutes,
  translateExternalActionsToInternal,
} from '../checkAlerts';

describe('checkAlerts', () => {
  afterAll(async () => {
    await clickhouse.client.close();
  });

  it('roundDownToXMinutes', () => {
    // 1 min
    const roundDownTo1Minute = roundDownToXMinutes(1);
    expect(
      roundDownTo1Minute(new Date('2023-03-17T22:13:03.103Z')).toISOString(),
    ).toBe('2023-03-17T22:13:00.000Z');
    expect(
      roundDownTo1Minute(new Date('2023-03-17T22:13:59.103Z')).toISOString(),
    ).toBe('2023-03-17T22:13:00.000Z');

    // 5 mins
    const roundDownTo5Minutes = roundDownToXMinutes(5);
    expect(
      roundDownTo5Minutes(new Date('2023-03-17T22:13:03.103Z')).toISOString(),
    ).toBe('2023-03-17T22:10:00.000Z');
    expect(
      roundDownTo5Minutes(new Date('2023-03-17T22:17:59.103Z')).toISOString(),
    ).toBe('2023-03-17T22:15:00.000Z');
    expect(
      roundDownTo5Minutes(new Date('2023-03-17T22:59:59.103Z')).toISOString(),
    ).toBe('2023-03-17T22:55:00.000Z');
  });

  it('buildLogSearchLink', () => {
    expect(
      buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        logViewId: '123',
      }),
    ).toBe(
      'http://localhost:9090/search/123?from=1679091183103&to=1679091239103',
    );
    expect(
      buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        logViewId: '123',
        q: '🐱 foo:"bar"',
      }),
    ).toBe(
      'http://localhost:9090/search/123?from=1679091183103&to=1679091239103&q=%F0%9F%90%B1+foo%3A%22bar%22',
    );
  });

  it('doesExceedThreshold', () => {
    expect(doesExceedThreshold(true, 10, 11)).toBe(true);
    expect(doesExceedThreshold(true, 10, 10)).toBe(true);
    expect(doesExceedThreshold(false, 10, 9)).toBe(true);
    expect(doesExceedThreshold(false, 10, 10)).toBe(false);
  });

  it('expandToNestedObject', () => {
    expect(expandToNestedObject({}).__proto__).toBeUndefined();
    expect(expandToNestedObject({})).toEqual({});
    expect(expandToNestedObject({ foo: 'bar' })).toEqual({ foo: 'bar' });
    expect(expandToNestedObject({ 'foo.bar': 'baz' })).toEqual({
      foo: { bar: 'baz' },
    });
    expect(expandToNestedObject({ 'foo.bar.baz': 'qux' })).toEqual({
      foo: { bar: { baz: 'qux' } },
    });
    // mix
    expect(
      expandToNestedObject({
        'foo.bar.baz': 'qux',
        'foo.bar.quux': 'quuz',
        'foo1.bar1.baz1': 'qux1',
      }),
    ).toEqual({
      foo: { bar: { baz: 'qux', quux: 'quuz' } },
      foo1: { bar1: { baz1: 'qux1' } },
    });
    // overwriting
    expect(
      expandToNestedObject({ 'foo.bar.baz': 'qux', 'foo.bar': 'quuz' }),
    ).toEqual({
      foo: { bar: 'quuz' },
    });
    // max depth
    expect(
      expandToNestedObject(
        {
          'foo.bar.baz.qux.quuz.quux': 'qux',
        },
        '.',
        3,
      ),
    ).toEqual({
      foo: { bar: { baz: {} } },
    });
  });

  describe('Alert Templates', () => {
    const defaultSearchView: any = {
      alert: {
        threshold_type: 'above',
        threshold: 1,
        source: 'search',
        groupBy: 'span_name',
      },
      savedSearch: {
        id: 'id-123',
        query: 'level:error',
        name: 'My Search',
      },
      team: {
        id: 'team-123',
        logStreamTableVersion: 1,
      },
      group: 'http',
      startTime: new Date('2023-03-17T22:13:03.103Z'),
      endTime: new Date('2023-03-17T22:13:59.103Z'),
      value: 10,
    };

    const defaultChartView: any = {
      alert: {
        threshold_type: 'below',
        threshold: 10,
        source: 'chart',
        groupBy: 'span_name',
      },
      dashboard: {
        id: 'id-123',
        name: 'My Dashboard',
        charts: [
          {
            name: 'My Chart',
          },
        ],
      },
      team: {
        id: 'team-123',
        logStreamTableVersion: 1,
      },
      startTime: new Date('2023-03-17T22:13:03.103Z'),
      endTime: new Date('2023-03-17T22:13:59.103Z'),
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
      expect(buildAlertMessageTemplateHdxLink(defaultSearchView)).toBe(
        'http://localhost:9090/search/id-123?from=1679091183103&to=1679091239103&q=level%3Aerror+span_name%3A%22http%22',
      );
      expect(buildAlertMessageTemplateHdxLink(defaultChartView)).toBe(
        'http://localhost:9090/dashboards/id-123?from=1679089083103&granularity=5+minute&to=1679093339103',
      );
    });

    it('buildAlertMessageTemplateTitle', () => {
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultSearchView,
        }),
      ).toBe('Alert for "My Search" - 10 lines found');
      expect(
        buildAlertMessageTemplateTitle({
          view: defaultChartView,
        }),
      ).toBe('Alert for "My Chart" in "My Dashboard" - 5 falls below 10');
    });

    it('getDefaultExternalAction', () => {
      expect(
        getDefaultExternalAction({
          channel: {
            type: 'slack_webhook',
            webhookId: '123',
          },
        } as any),
      ).toBe('@slack_webhook-123');
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
        translateExternalActionsToInternal('@slack_webhook-123'),
      ).toMatchInlineSnapshot(
        `"{{__hdx_notify_channel__ channel=\\"slack_webhook\\" id=\\"123\\"}}"`,
      );

      // with multiple breaks
      expect(
        translateExternalActionsToInternal(`

@slack_webhook-123
`),
      ).toMatchInlineSnapshot(`
"
{{__hdx_notify_channel__ channel=\\"slack_webhook\\" id=\\"123\\"}}
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
      jest.spyOn(clickhouse, 'getLogBatch').mockResolvedValueOnce({
        data: [
          {
            timestamp: '2023-11-16T22:10:00.000Z',
            severity_text: 'error',
            body: 'Oh no! Something went wrong!',
          },
          {
            timestamp: '2023-11-16T22:15:00.000Z',
            severity_text: 'info',
            body: 'All good!',
          },
        ],
      } as any);

      const team = await createTeam({ name: 'My Team' });
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        template: 'Custom body @slack_webhook-My_Web', // partial name should work
        view: {
          ...defaultSearchView,
          alert: {
            ...defaultSearchView.alert,
            channel: {
              type: 'slack_webhook',
              webhookId: webhook._id.toString(),
            },
          },
        },
        title: 'Alert for "My Search" - 10 lines found',
        team: {
          id: team._id.toString(),
          logStreamTableVersion: team.logStreamTableVersion,
        },
      });

      expect(slack.postMessageToWebhook).toHaveBeenCalledTimes(2);
      // TODO: test call arguments
    });

    it('renderAlertTemplate - custom body with single action', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);
      jest.spyOn(clickhouse, 'getLogBatch').mockResolvedValueOnce({
        data: [
          {
            timestamp: '2023-11-16T22:10:00.000Z',
            severity_text: 'error',
            body: 'Oh no! Something went wrong!',
          },
          {
            timestamp: '2023-11-16T22:15:00.000Z',
            severity_text: 'info',
            body: 'All good!',
          },
        ],
      } as any);

      const team = await createTeam({ name: 'My Team' });
      await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        template: 'Custom body @slack_webhook-My_Web', // partial name should work
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
          logStreamTableVersion: team.logStreamTableVersion,
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
                  '*<http://localhost:9090/search/id-123?from=1679091183103&to=1679091239103&q=level%3Aerror+span_name%3A%22http%22 | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  'Custom body ',
                  '```',
                  'Nov 16 22:10:00Z [error] Oh no! Something went wrong!',
                  'Nov 16 22:15:00Z [info] All good!',
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
      jest.spyOn(clickhouse, 'getLogBatch').mockResolvedValueOnce({
        data: [
          {
            timestamp: '2023-11-16T22:10:00.000Z',
            severity_text: 'error',
            body: 'Oh no! Something went wrong!',
          },
          {
            timestamp: '2023-11-16T22:15:00.000Z',
            severity_text: 'info',
            body: 'All good!',
          },
        ],
      } as any);

      const team = await createTeam({ name: 'My Team' });
      await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My_Webhook',
      }).save();

      await renderAlertTemplate({
        template: 'Custom body @slack_webhook-{{attributes.webhookName}}', // partial name should work
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
          logStreamTableVersion: team.logStreamTableVersion,
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
                  '*<http://localhost:9090/search/id-123?from=1679091183103&to=1679091239103&q=level%3Aerror+span_name%3A%22http%22 | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  'Custom body ',
                  '```',
                  'Nov 16 22:10:00Z [error] Oh no! Something went wrong!',
                  'Nov 16 22:15:00Z [info] All good!',
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
      jest.spyOn(clickhouse, 'getLogBatch').mockResolvedValueOnce({
        data: [
          {
            timestamp: '2023-11-16T22:10:00.000Z',
            severity_text: 'error',
            body: 'Oh no! Something went wrong!',
          },
          {
            timestamp: '2023-11-16T22:15:00.000Z',
            severity_text: 'info',
            body: 'All good!',
          },
        ],
      } as any);

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
        template: `
{{#is_match "attributes.k8s.pod.name" "otel-collector-123"}}
  Runbook URL: {{attributes.runbook.url}}
  hi i matched
  @slack_webhook-My_Web
{{/is_match}}

@slack_webhook-Another_Webhook
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
          logStreamTableVersion: team.logStreamTableVersion,
        },
      });

      // @slack_webhook should not be called
      await renderAlertTemplate({
        template:
          '{{#is_match "attributes.host" "web"}} @slack_webhook-My_Web {{/is_match}}', // partial name should work
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
          logStreamTableVersion: team.logStreamTableVersion,
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
                  '*<http://localhost:9090/search/id-123?from=1679091183103&to=1679091239103&q=level%3Aerror+span_name%3A%22http%22 | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  '',
                  '  Runbook URL: https://example.com',
                  '  hi i matched',
                  '  ',
                  '',
                  '',
                  '```',
                  'Nov 16 22:10:00Z [error] Oh no! Something went wrong!',
                  'Nov 16 22:15:00Z [info] All good!',
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
                  '*<http://localhost:9090/search/id-123?from=1679091183103&to=1679091239103&q=level%3Aerror+span_name%3A%22http%22 | Alert for "My Search" - 10 lines found>*',
                  'Group: "http"',
                  '10 lines found, expected less than 1 lines',
                  '',
                  '  Runbook URL: https://example.com',
                  '  hi i matched',
                  '  ',
                  '',
                  '',
                  '```',
                  'Nov 16 22:10:00Z [error] Oh no! Something went wrong!',
                  'Nov 16 22:15:00Z [info] All good!',
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

    it('LOG alert - slack webhook', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);
      jest
        .spyOn(clickhouse, 'checkAlert')
        .mockResolvedValueOnce({
          rows: 1,
          data: [
            {
              data: '11',
              group: 'HyperDX',
              ts_bucket: 1700172600,
            },
          ],
        } as any)
        // no logs found in the next window
        .mockResolvedValueOnce({
          rows: 0,
          data: [],
        } as any);
      jest.spyOn(clickhouse, 'getLogBatch').mockResolvedValueOnce({
        rows: 1,
        data: [
          {
            timestamp: '2023-11-16T22:10:00.000Z',
            severity_text: 'error',
            body: 'Oh no! Something went wrong!',
          },
        ],
      } as any);

      const team = await createTeam({ name: 'My Team' });
      const logView = await new LogView({
        name: 'My Log View',
        query: `level:error`,
        team: team._id,
      }).save();
      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const alert = await createAlert(team._id, {
        source: 'LOG',
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        type: 'presence',
        threshold: 10,
        groupBy: 'span_name',
        logViewId: logView._id.toString(),
      });

      const now = new Date('2023-11-16T22:12:00.000Z');

      // shoud fetch 5m of logs
      await processAlert(now, alert);
      expect(alert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);
      // alert should still be in alert state
      expect(alert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, alert);
      // alert should be in ok state
      expect(alert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(2);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );
      expect(alertHistories[1].state).toBe('OK');
      expect(alertHistories[1].counts).toBe(0);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // check if checkAlert query + webhook were triggered
      expect(clickhouse.checkAlert).toHaveBeenNthCalledWith(1, {
        endTime: new Date('2023-11-16T22:10:00.000Z'),
        groupBy: alert.groupBy,
        q: logView.query,
        startTime: new Date('2023-11-16T22:05:00.000Z'),
        tableVersion: team.logStreamTableVersion,
        teamId: logView.team._id.toString(),
        windowSizeInMins: 5,
      });
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "My Log View" - 11 lines found',
          blocks: [
            {
              text: {
                text: [
                  `*<http://localhost:9090/search/${logView._id}?from=1700172600000&to=1700172900000&q=level%3Aerror+span_name%3A%22HyperDX%22 | Alert for "My Log View" - 11 lines found>*`,
                  'Group: "HyperDX"',
                  '11 lines found, expected less than 10 lines',
                  '',
                  '```',
                  'Nov 16 22:10:00Z [error] Oh no! Something went wrong!',
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

    it('CHART alert (logs table series) - slack webhook', async () => {
      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);
      mockLogsPropertyTypeMappingsModel({
        runId: 'string',
      });

      const team = await createTeam({ name: 'My Team' });

      const runId = Math.random().toString(); // dedup watch mode runs
      const teamId = team._id.toString();
      const now = new Date('2023-11-16T22:12:00.000Z');
      // Send events in the last alert window 22:05 - 22:10
      const eventMs = now.getTime() - ms('5m');

      const buildEvent = generateBuildTeamEventFn(teamId, {
        runId,
        span_name: 'HyperDX',
        type: LogType.Span,
        level: 'error',
      });

      await clickhouse.bulkInsertLogStream([
        buildEvent({
          timestamp: eventMs,
          end_timestamp: eventMs + 100,
        }),
        buildEvent({
          timestamp: eventMs + 5,
          end_timestamp: eventMs + 7,
        }),
      ]);

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        charts: [
          {
            id: '198hki',
            name: 'Max Duration',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'logs',
                type: 'time',
                aggFn: 'sum',
                field: 'duration',
                where: `level:error runId:${runId}`,
                groupBy: ['span_name'],
              },
              {
                table: 'logs',
                type: 'time',
                aggFn: 'min',
                field: 'duration',
                where: `level:error runId:${runId}`,
                groupBy: ['span_name'],
              },
            ],
            seriesReturnType: 'column',
          },
          {
            id: 'obil1',
            name: 'Min Duratioin',
            x: 6,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'logs',
                type: 'time',
                aggFn: 'min',
                field: 'duration',
                where: '',
                groupBy: [],
              },
            ],
          },
        ],
      }).save();
      const alert = await createAlert(team._id, {
        source: 'CHART',
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        type: 'presence',
        threshold: 10,
        dashboardId: dashboard._id.toString(),
        chartId: '198hki',
      });

      // should fetch 5m of logs
      await processAlert(now, alert);
      expect(alert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);
      // alert should still be in alert state
      expect(alert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, alert);
      // alert should be in ok state
      expect(alert.state).toBe('OK');

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
      expect(history1.lastValues.length).toBe(2);
      expect(history1.lastValues.length).toBeGreaterThan(0);
      expect(history1.lastValues[0].count).toBeGreaterThanOrEqual(1);

      expect(history2.state).toBe('OK');
      expect(history2.counts).toBe(0);
      expect(history2.createdAt).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      // check if webhook was triggered
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "Max Duration" in "My Dashboard" - 102 exceeds 10',
          blocks: [
            {
              text: {
                text: [
                  `*<http://localhost:9090/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Max Duration" in "My Dashboard" - 102 exceeds 10>*`,
                  'Group: "HyperDX"',
                  '102 exceeds 10',
                  '',
                ].join('\n'),
                type: 'mrkdwn',
              },
              type: 'section',
            },
          ],
        },
      );

      jest.resetAllMocks();
    });

    it('CHART alert (metrics table series) - slack webhook', async () => {
      const team = await createTeam({ name: 'My Team' });

      const runId = Math.random().toString(); // dedup watch mode runs
      const teamId = team._id.toString();

      jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValueOnce(null as any);

      const now = new Date('2023-11-16T22:12:00.000Z');
      // Need data in 22:00 - 22:05 to calculate a rate for 22:05 - 22:10
      const metricNowTs = new Date('2023-11-16T22:00:00.000Z').getTime();

      mockSpyMetricPropertyTypeMappingsModel({
        runId: 'string',
        host: 'string',
        'cloud.provider': 'string',
      });

      await clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'redis.memory.rss',
          tags: {
            host: 'HyperDX',
            'cloud.provider': 'aws',
            runId,
            series: '1',
          },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Bytes',
          points: [
            { value: 1, timestamp: metricNowTs },
            { value: 8, timestamp: metricNowTs + ms('1m') },
            { value: 8, timestamp: metricNowTs + ms('2m') },
            { value: 9, timestamp: metricNowTs + ms('3m') },
            { value: 15, timestamp: metricNowTs + ms('4m') }, // 15
            { value: 30, timestamp: metricNowTs + ms('5m') },
            { value: 31, timestamp: metricNowTs + ms('6m') },
            { value: 32, timestamp: metricNowTs + ms('7m') },
            { value: 33, timestamp: metricNowTs + ms('8m') },
            { value: 34, timestamp: metricNowTs + ms('9m') }, // 34
            { value: 35, timestamp: metricNowTs + ms('10m') },
            { value: 36, timestamp: metricNowTs + ms('11m') },
          ],
          team_id: teamId,
        }),
      );

      await clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'redis.memory.rss',
          tags: {
            host: 'HyperDX',
            'cloud.provider': 'aws',
            runId,
            series: '2',
          },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Bytes',
          points: [
            { value: 1000, timestamp: metricNowTs },
            { value: 8000, timestamp: metricNowTs + ms('1m') },
            { value: 8000, timestamp: metricNowTs + ms('2m') },
            { value: 9000, timestamp: metricNowTs + ms('3m') },
            { value: 15000, timestamp: metricNowTs + ms('4m') }, // 15000
            { value: 30000, timestamp: metricNowTs + ms('5m') },
            { value: 30001, timestamp: metricNowTs + ms('6m') },
            { value: 30002, timestamp: metricNowTs + ms('7m') },
            { value: 30003, timestamp: metricNowTs + ms('8m') },
            { value: 30004, timestamp: metricNowTs + ms('9m') }, // 30004
            { value: 30005, timestamp: metricNowTs + ms('10m') },
            { value: 30006, timestamp: metricNowTs + ms('11m') },
          ],
          team_id: teamId,
        }),
      );

      await clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'redis.memory.rss',
          tags: { host: 'test2', 'cloud.provider': 'aws', runId, series: '0' },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Bytes',
          points: [
            { value: 1, timestamp: metricNowTs },
            { value: 8, timestamp: metricNowTs + ms('1m') },
            { value: 8, timestamp: metricNowTs + ms('2m') },
            { value: 9, timestamp: metricNowTs + ms('3m') },
            { value: 15, timestamp: metricNowTs + ms('4m') }, // 15
            { value: 17, timestamp: metricNowTs + ms('5m') },
            { value: 18, timestamp: metricNowTs + ms('6m') },
            { value: 19, timestamp: metricNowTs + ms('7m') },
            { value: 20, timestamp: metricNowTs + ms('8m') },
            { value: 21, timestamp: metricNowTs + ms('9m') }, // 21
            { value: 22, timestamp: metricNowTs + ms('10m') },
            { value: 23, timestamp: metricNowTs + ms('11m') },
          ],
          team_id: teamId,
        }),
      );

      const webhook = await new Webhook({
        team: team._id,
        service: 'slack',
        url: 'https://hooks.slack.com/services/123',
        name: 'My Webhook',
      }).save();
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        charts: [
          {
            id: '198hki',
            name: 'Redis Memory',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'metrics',
                type: 'time',
                aggFn: 'avg_rate',
                field: 'redis.memory.rss - Sum',
                where: `cloud.provider:"aws" runId:${runId}`,
                groupBy: ['host'],
              },
              {
                table: 'metrics',
                type: 'time',
                aggFn: 'min_rate',
                field: 'redis.memory.rss - Sum',
                where: `cloud.provider:"aws" runId:${runId}`,
                groupBy: ['host'],
              },
            ],
            seriesReturnType: 'ratio',
          },
          {
            id: 'obil1',
            name: 'Min Duratioin',
            x: 6,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'logs',
                type: 'time',
                aggFn: 'min',
                field: 'duration',
                where: '',
                groupBy: [],
              },
            ],
          },
        ],
      }).save();
      const alert = await createAlert(team._id, {
        source: 'CHART',
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        type: 'presence',
        threshold: 10,
        dashboardId: dashboard._id.toString(),
        chartId: '198hki',
      });

      // shoud fetch 5m of metrics
      await processAlert(now, alert);
      expect(alert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);
      // alert should still be in alert state
      expect(alert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, alert);
      // alert should be in ok state
      expect(alert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(2);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );
      expect(alertHistories[1].state).toBe('OK');
      expect(alertHistories[1].counts).toBe(0);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // check if webhook was triggered
      expect(slack.postMessageToWebhook).toHaveBeenNthCalledWith(
        1,
        'https://hooks.slack.com/services/123',
        {
          text: 'Alert for "Redis Memory" in "My Dashboard" - 395.3421052631579 exceeds 10',
          blocks: [
            {
              text: {
                text: [
                  `*<http://localhost:9090/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Redis Memory" in "My Dashboard" - 395.3421052631579 exceeds 10>*`,
                  'Group: "HyperDX"',
                  '395.3421052631579 exceeds 10',
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

    it('LOG alert - generic webhook', async () => {
      jest.spyOn(checkAlert, 'handleSendGenericWebhook');
      jest
        .spyOn(clickhouse, 'checkAlert')
        .mockResolvedValueOnce({
          rows: 1,
          data: [
            {
              data: '11',
              group: 'HyperDX',
              ts_bucket: 1700172600,
            },
          ],
        } as any)
        // no logs found in the next window
        .mockResolvedValueOnce({
          rows: 0,
          data: [],
        } as any);
      jest.spyOn(clickhouse, 'getLogBatch').mockResolvedValueOnce({
        rows: 1,
        data: [
          {
            timestamp: '2023-11-16T22:10:00.000Z',
            severity_text: 'error',
            body: 'Oh no! Something went wrong!',
          },
        ],
      } as any);

      const fetchMock = jest.fn().mockResolvedValue({});
      global.fetch = fetchMock;

      const team = await createTeam({ name: 'My Team' });
      const logView = await new LogView({
        name: 'My Log View',
        query: `level:error`,
        team: team._id,
      }).save();
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
          'X-HyperDX-Signature': 'XXXXX-XXXXX',
        },
      }).save();
      const alert = await createAlert(team._id, {
        source: 'LOG',
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        type: 'presence',
        threshold: 10,
        groupBy: 'span_name',
        logViewId: logView._id.toString(),
      });

      const now = new Date('2023-11-16T22:12:00.000Z');

      // shoud fetch 5m of logs
      await processAlert(now, alert);
      expect(alert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);
      // alert should still be in alert state
      expect(alert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, alert);
      // alert should be in ok state
      expect(alert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(2);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );
      expect(alertHistories[1].state).toBe('OK');
      expect(alertHistories[1].counts).toBe(0);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // check if checkAlert query + webhook were triggered
      expect(clickhouse.checkAlert).toHaveBeenNthCalledWith(1, {
        endTime: new Date('2023-11-16T22:10:00.000Z'),
        groupBy: alert.groupBy,
        q: logView.query,
        startTime: new Date('2023-11-16T22:05:00.000Z'),
        tableVersion: team.logStreamTableVersion,
        teamId: logView.team._id.toString(),
        windowSizeInMins: 5,
      });
      // check if generic webhook was triggered, injected, and parsed, and sent correctly
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://webhook.site/123', {
        method: 'POST',
        body: `{"text":"http://localhost:9090/search/${logView.id}?from=1700172600000&to=1700172900000&q=level%3Aerror+span_name%3A%22HyperDX%22 | Alert for "My Log View" - 11 lines found"}`,
        headers: {
          'Content-Type': 'application/json',
          'X-HyperDX-Signature': 'XXXXX-XXXXX',
        },
      });
    });

    it('CHART alert (logs table series) - generic webhook', async () => {
      jest.spyOn(checkAlert, 'handleSendGenericWebhook');
      mockLogsPropertyTypeMappingsModel({
        runId: 'string',
      });

      const fetchMock = jest.fn().mockResolvedValue({});
      global.fetch = fetchMock;

      const team = await createTeam({ name: 'My Team' });

      const runId = Math.random().toString(); // dedup watch mode runs
      const teamId = team._id.toString();
      const now = new Date('2023-11-16T22:12:00.000Z');
      // Send events in the last alert window 22:05 - 22:10
      const eventMs = now.getTime() - ms('5m');

      const buildEvent = generateBuildTeamEventFn(teamId, {
        runId,
        span_name: 'HyperDX',
        type: LogType.Span,
        level: 'error',
      });

      await clickhouse.bulkInsertLogStream([
        buildEvent({
          timestamp: eventMs,
          end_timestamp: eventMs + 100,
        }),
        buildEvent({
          timestamp: eventMs + 5,
          end_timestamp: eventMs + 7,
        }),
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
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        charts: [
          {
            id: '198hki',
            name: 'Max Duration',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'logs',
                type: 'time',
                aggFn: 'sum',
                field: 'duration',
                where: `level:error runId:${runId}`,
                groupBy: ['span_name'],
              },
              {
                table: 'logs',
                type: 'time',
                aggFn: 'min',
                field: 'duration',
                where: `level:error runId:${runId}`,
                groupBy: ['span_name'],
              },
            ],
            seriesReturnType: 'column',
          },
          {
            id: 'obil1',
            name: 'Min Duratioin',
            x: 6,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'logs',
                type: 'time',
                aggFn: 'min',
                field: 'duration',
                where: '',
                groupBy: [],
              },
            ],
          },
        ],
      }).save();
      const alert = await createAlert(team._id, {
        source: 'CHART',
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        type: 'presence',
        threshold: 10,
        dashboardId: dashboard._id.toString(),
        chartId: '198hki',
      });

      // should fetch 5m of logs
      await processAlert(now, alert);
      expect(alert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);
      // alert should still be in alert state
      expect(alert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, alert);
      // alert should be in ok state
      expect(alert.state).toBe('OK');

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
      expect(history1.lastValues.length).toBe(2);
      expect(history1.lastValues.length).toBeGreaterThan(0);
      expect(history1.lastValues[0].count).toBeGreaterThanOrEqual(1);

      expect(history2.state).toBe('OK');
      expect(history2.counts).toBe(0);
      expect(history2.createdAt).toEqual(new Date('2023-11-16T22:15:00.000Z'));

      // check if generic webhook was triggered, injected, and parsed, and sent correctly
      expect(fetchMock).toHaveBeenCalledWith('https://webhook.site/123', {
        method: 'POST',
        body: `{"text":"http://localhost:9090/dashboards/${dashboard.id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Max Duration" in "My Dashboard" - 102 exceeds 10"}`,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('CHART alert (metrics table series) - generic webhook', async () => {
      const team = await createTeam({ name: 'My Team' });

      const runId = Math.random().toString(); // dedup watch mode runs
      const teamId = team._id.toString();

      jest.spyOn(checkAlert, 'handleSendGenericWebhook');

      const fetchMock = jest.fn().mockResolvedValue({});
      global.fetch = fetchMock;

      const now = new Date('2023-11-16T22:12:00.000Z');
      // Need data in 22:00 - 22:05 to calculate a rate for 22:05 - 22:10
      const metricNowTs = new Date('2023-11-16T22:00:00.000Z').getTime();

      mockSpyMetricPropertyTypeMappingsModel({
        runId: 'string',
        host: 'string',
        'cloud.provider': 'string',
      });

      await clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'redis.memory.rss',
          tags: {
            host: 'HyperDX',
            'cloud.provider': 'aws',
            runId,
            series: '1',
          },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Bytes',
          points: [
            { value: 1, timestamp: metricNowTs },
            { value: 8, timestamp: metricNowTs + ms('1m') },
            { value: 8, timestamp: metricNowTs + ms('2m') },
            { value: 9, timestamp: metricNowTs + ms('3m') },
            { value: 15, timestamp: metricNowTs + ms('4m') }, // 15
            { value: 30, timestamp: metricNowTs + ms('5m') },
            { value: 31, timestamp: metricNowTs + ms('6m') },
            { value: 32, timestamp: metricNowTs + ms('7m') },
            { value: 33, timestamp: metricNowTs + ms('8m') },
            { value: 34, timestamp: metricNowTs + ms('9m') }, // 34
            { value: 35, timestamp: metricNowTs + ms('10m') },
            { value: 36, timestamp: metricNowTs + ms('11m') },
          ],
          team_id: teamId,
        }),
      );

      await clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'redis.memory.rss',
          tags: {
            host: 'HyperDX',
            'cloud.provider': 'aws',
            runId,
            series: '2',
          },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Bytes',
          points: [
            { value: 1000, timestamp: metricNowTs },
            { value: 8000, timestamp: metricNowTs + ms('1m') },
            { value: 8000, timestamp: metricNowTs + ms('2m') },
            { value: 9000, timestamp: metricNowTs + ms('3m') },
            { value: 15000, timestamp: metricNowTs + ms('4m') }, // 15000
            { value: 30000, timestamp: metricNowTs + ms('5m') },
            { value: 30001, timestamp: metricNowTs + ms('6m') },
            { value: 30002, timestamp: metricNowTs + ms('7m') },
            { value: 30003, timestamp: metricNowTs + ms('8m') },
            { value: 30004, timestamp: metricNowTs + ms('9m') }, // 30004
            { value: 30005, timestamp: metricNowTs + ms('10m') },
            { value: 30006, timestamp: metricNowTs + ms('11m') },
          ],
          team_id: teamId,
        }),
      );

      await clickhouse.bulkInsertTeamMetricStream(
        buildMetricSeries({
          name: 'redis.memory.rss',
          tags: { host: 'test2', 'cloud.provider': 'aws', runId, series: '0' },
          data_type: clickhouse.MetricsDataType.Sum,
          is_monotonic: true,
          is_delta: true,
          unit: 'Bytes',
          points: [
            { value: 1, timestamp: metricNowTs },
            { value: 8, timestamp: metricNowTs + ms('1m') },
            { value: 8, timestamp: metricNowTs + ms('2m') },
            { value: 9, timestamp: metricNowTs + ms('3m') },
            { value: 15, timestamp: metricNowTs + ms('4m') }, // 15
            { value: 17, timestamp: metricNowTs + ms('5m') },
            { value: 18, timestamp: metricNowTs + ms('6m') },
            { value: 19, timestamp: metricNowTs + ms('7m') },
            { value: 20, timestamp: metricNowTs + ms('8m') },
            { value: 21, timestamp: metricNowTs + ms('9m') }, // 21
            { value: 22, timestamp: metricNowTs + ms('10m') },
            { value: 23, timestamp: metricNowTs + ms('11m') },
          ],
          team_id: teamId,
        }),
      );

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
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        team: team._id,
        charts: [
          {
            id: '198hki',
            name: 'Redis Memory',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'metrics',
                type: 'time',
                aggFn: 'avg_rate',
                field: 'redis.memory.rss - Sum',
                where: `cloud.provider:"aws" runId:${runId}`,
                groupBy: ['host'],
              },
              {
                table: 'metrics',
                type: 'time',
                aggFn: 'min_rate',
                field: 'redis.memory.rss - Sum',
                where: `cloud.provider:"aws" runId:${runId}`,
                groupBy: ['host'],
              },
            ],
            seriesReturnType: 'ratio',
          },
          {
            id: 'obil1',
            name: 'Min Duratioin',
            x: 6,
            y: 0,
            w: 6,
            h: 3,
            series: [
              {
                table: 'logs',
                type: 'time',
                aggFn: 'min',
                field: 'duration',
                where: '',
                groupBy: [],
              },
            ],
          },
        ],
      }).save();
      const alert = await createAlert(team._id, {
        source: 'CHART',
        channel: {
          type: 'webhook',
          webhookId: webhook._id.toString(),
        },
        interval: '5m',
        type: 'presence',
        threshold: 10,
        dashboardId: dashboard._id.toString(),
        chartId: '198hki',
      });

      // shoud fetch 5m of metrics
      await processAlert(now, alert);
      expect(alert.state).toBe('ALERT');

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);
      // alert should still be in alert state
      expect(alert.state).toBe('ALERT');

      const nextWindow = new Date('2023-11-16T22:16:00.000Z');
      await processAlert(nextWindow, alert);
      // alert should be in ok state
      expect(alert.state).toBe('OK');

      // check alert history
      const alertHistories = await AlertHistory.find({
        alert: alert._id,
      }).sort({
        createdAt: 1,
      });
      expect(alertHistories.length).toBe(2);
      expect(alertHistories[0].state).toBe('ALERT');
      expect(alertHistories[0].counts).toBe(1);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );
      expect(alertHistories[1].state).toBe('OK');
      expect(alertHistories[1].counts).toBe(0);
      expect(alertHistories[1].createdAt).toEqual(
        new Date('2023-11-16T22:15:00.000Z'),
      );

      // check if generic webhook was triggered, injected, and parsed, and sent correctly
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://webhook.site/123', {
        method: 'POST',
        body: `{"text":"http://localhost:9090/dashboards/${dashboard.id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Redis Memory" in "My Dashboard" - 395.3421052631579 exceeds 10"}`,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      jest.resetAllMocks();
    });
  });
});
