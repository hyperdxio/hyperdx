import * as clickhouse from '../../clickhouse';
import AlertHistory from '../../models/alertHistory';
import LogView from '../../models/logView';
import Webhook from '../../models/webhook';
import {
  buildLogSearchLink,
  doesExceedThreshold,
  processAlert,
  roundDownToXMinutes,
} from '../checkAlerts';
import { clearDBCollections, closeDB, getServer } from '../../fixtures';
import { createAlert } from '../../controllers/alerts';
import { createTeam } from '../../controllers/team';

describe('checkAlerts', () => {
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
      await clearDBCollections();
    });

    afterAll(async () => {
      await server.closeHttpServer();
      await closeDB();
    });

    it('alert should be triggered and skipped if time diff is less than 1 window size', async () => {
      jest.spyOn(clickhouse, 'checkAlert').mockResolvedValueOnce({
        rows: 0,
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
      const alert = await createAlert({
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
      // check alert history
      const alertHistories = await AlertHistory.find({
        alertId: alert._id,
      });
      expect(alertHistories.length).toBe(1);
      expect(alertHistories[0].counts).toBe(0);
      expect(alertHistories[0].createdAt).toEqual(
        new Date('2023-11-16T22:10:00.000Z'),
      );

      // skip since time diff is less than 1 window size
      const later = new Date('2023-11-16T22:14:00.000Z');
      await processAlert(later, alert);

      expect(clickhouse.checkAlert).toHaveBeenNthCalledWith(1, {
        endTime: new Date('2023-11-16T22:10:00.000Z'),
        groupBy: alert.groupBy,
        q: logView.query,
        startTime: new Date('2023-11-16T22:05:00.000Z'),
        tableVersion: team.logStreamTableVersion,
        teamId: logView.team._id.toString(),
        windowSizeInMins: 5,
      });
    });
  });
});
