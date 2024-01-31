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
import {
  buildLogSearchLink,
  doesExceedThreshold,
  processAlert,
  roundDownToXMinutes,
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
        logView: {
          _id: 123,
        } as any,
      }),
    ).toBe(
      'http://localhost:9090/search/123?from=1679091183103&to=1679091239103',
    );
    expect(
      buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        logView: {
          _id: 123,
        } as any,
        q: '🐱 foo:"bar"',
      }),
    ).toBe(
      'http://localhost:9090/search/123?from=1679091183103&to=1679091239103&q=%F0%9F%90%B1+foo%3A%22bar%22',
    );
  });

  it('doesExceedThreshold', () => {
    expect(
      doesExceedThreshold(
        {
          type: 'presence',
          threshold: 10,
        } as any,
        11,
      ),
    ).toBe(true);
    expect(
      doesExceedThreshold(
        {
          type: 'presence',
          threshold: 10,
        } as any,
        10,
      ),
    ).toBe(true);
    expect(
      doesExceedThreshold(
        {
          type: 'absence',
          threshold: 10,
        } as any,
        9,
      ),
    ).toBe(true);
    expect(
      doesExceedThreshold(
        {
          type: 'absence',
          threshold: 10,
        } as any,
        10,
      ),
    ).toBe(false);
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

    it('LOG alert', async () => {
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
          text: 'Alert for My Log View - 11 lines found',
          blocks: [
            {
              text: {
                text: [
                  `*<http://localhost:9090/search/${logView._id}?from=1700172600000&to=1700172900000&q=level%3Aerror+span_name%3A%22HyperDX%22 | Alert for My Log View>*`,
                  'Group: "HyperDX"',
                  '11 lines found, expected less than 10 lines',
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

    it('CHART alert (logs table series)', async () => {
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
                  `*<http://localhost:9090/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Max Duration" in "My Dashboard">*`,
                  'Group: "HyperDX"',
                  '102 exceeds 10',
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

    it('CHART alert (metrics table series)', async () => {
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
                  `*<http://localhost:9090/dashboards/${dashboard._id}?from=1700170200000&granularity=5+minute&to=1700174700000 | Alert for "Redis Memory" in "My Dashboard">*`,
                  'Group: "HyperDX"',
                  '395.3421052631579 exceeds 10',
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
