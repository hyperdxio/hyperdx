import { ObjectId } from 'mongodb';

import {
  ALERT_EVALUATION_GROUPS_LIMIT,
  getAlertEvaluations,
  getAlertTransitionsInRange,
  getRecentAlertHistories,
  getRecentAlertHistoriesBatch,
} from '@/controllers/alertHistory';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Alert, { AlertState } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Team from '@/models/team';

describe('alertHistory controller', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  describe('getRecentAlertHistories', () => {
    it('should return empty array when no histories exist', async () => {
      const alertId = new ObjectId();
      const histories = await getRecentAlertHistories({
        alertId,
        interval: '5m',
        limit: 10,
      });

      expect(histories).toEqual([]);
    });

    it('should return recent alert histories for a given alert', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const now = new Date(Date.now() - 60000);
      const earlier = new Date(Date.now() - 120000);

      await AlertHistory.create({
        alert: alert._id,
        createdAt: now,
        state: AlertState.ALERT,
        counts: 5,
        lastValues: [{ startTime: now, count: 5 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: earlier,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: earlier, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(2);
      expect(histories[0].createdAt).toEqual(now);
      expect(histories[0].state).toBe(AlertState.ALERT);
      expect(histories[0].counts).toBe(5);
      expect(histories[1].createdAt).toEqual(earlier);
      expect(histories[1].state).toBe(AlertState.OK);
      expect(histories[1].counts).toBe(0);
    });

    it('should respect the limit parameter', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      // Create 5 histories
      for (let i = 0; i < 5; i++) {
        await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(Date.now() - i * 60000),
          state: AlertState.OK,
          counts: 0,
          lastValues: [
            { startTime: new Date(Date.now() - i * 60000), count: 0 },
          ],
        });
      }

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 3,
      });

      expect(histories).toHaveLength(3);
    });

    it('should group histories by createdAt timestamp', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const timestamp = new Date(Date.now() - 60000);

      // Create multiple histories with the same timestamp
      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].createdAt).toEqual(timestamp);
      expect(histories[0].counts).toBe(0); // 0 + 0
      expect(histories[0].lastValues).toHaveLength(2);
    });

    it('should set state to ALERT if any grouped history has ALERT state', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const timestamp = new Date(Date.now() - 60000);

      // Create histories with mixed states at the same timestamp
      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.ALERT,
        counts: 3,
        lastValues: [{ startTime: timestamp, count: 3 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].state).toBe(AlertState.ALERT);
      expect(histories[0].counts).toBe(3); // 0 + 3 + 0
    });

    it('should set state to OK when all grouped histories are OK', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const timestamp = new Date(Date.now() - 60000);

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].state).toBe(AlertState.OK);
    });

    it('should sort histories by createdAt in descending order', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const oldest = new Date(Date.now() - 180000);
      const middle = new Date(Date.now() - 120000);
      const newest = new Date(Date.now() - 60000);

      // Create in random order
      await AlertHistory.create({
        alert: alert._id,
        createdAt: middle,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: middle, count: 0 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: newest,
        state: AlertState.ALERT,
        counts: 3,
        lastValues: [{ startTime: newest, count: 3 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: oldest,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: oldest, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(3);
      expect(histories[0].createdAt).toEqual(newest);
      expect(histories[1].createdAt).toEqual(middle);
      expect(histories[2].createdAt).toEqual(oldest);
    });

    it('should sort lastValues by startTime in ascending order', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const timestamp = new Date(Date.now() - 60000);
      const older = new Date(Date.now() - 120000);
      const newer = new Date(Date.now() - 30000);

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: older, count: 0 }],
      });

      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: newer, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].lastValues).toHaveLength(2);
      expect(histories[0].lastValues[0].startTime).toEqual(older);
      expect(histories[0].lastValues[1].startTime).toEqual(newer);
    });

    it('should only return histories for the specified alert', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert1 = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const alert2 = await Alert.create({
        team: team._id,
        threshold: 200,
        interval: '5m',
        channel: { type: null },
      });

      const timestamp = new Date(Date.now() - 60000);

      await AlertHistory.create({
        alert: alert1._id,
        createdAt: timestamp,
        state: AlertState.ALERT,
        counts: 5,
        lastValues: [{ startTime: timestamp, count: 5 }],
      });

      await AlertHistory.create({
        alert: alert2._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert1._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].state).toBe(AlertState.ALERT);
      expect(histories[0].counts).toBe(5);
    });

    it('surfaces ERROR windows with their recorded errors', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const errorWindow = new Date(Date.now() - 60000);
      const okWindow = new Date(Date.now() - 120000);
      const errorTimestamp = new Date(Date.now() - 55000);

      await AlertHistory.create({
        alert: alert._id,
        createdAt: errorWindow,
        state: AlertState.ERROR,
        counts: 0,
        lastValues: [],
        errors: [
          {
            timestamp: errorTimestamp,
            type: 'QUERY_TIMEOUT',
            message: 'Alert query did not complete within the 300s timeout',
          },
        ],
      });
      await AlertHistory.create({
        alert: alert._id,
        createdAt: okWindow,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: okWindow, count: 0 }],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(2);
      expect(histories[0].state).toBe(AlertState.ERROR);
      expect(histories[0].errors).toHaveLength(1);
      expect(histories[0].errors![0].type).toBe('QUERY_TIMEOUT');
      expect(histories[0].errors![0].message).toContain('300s timeout');
      expect(histories[1].state).toBe(AlertState.OK);
      expect(histories[1].errors).toBeUndefined();
    });

    it('lets ALERT/PENDING outrank ERROR within a grouped window, but ERROR outrank OK', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const alertWindow = new Date(Date.now() - 60000);
      const okWindow = new Date(Date.now() - 120000);
      const makeError = () => ({
        timestamp: new Date(),
        type: 'WEBHOOK_ERROR',
        message: 'Failed to send webhook notification.',
      });

      // Window that fired AND recorded a notification error → shows ALERT
      await AlertHistory.create({
        alert: alert._id,
        createdAt: alertWindow,
        state: AlertState.ALERT,
        counts: 2,
        lastValues: [{ startTime: alertWindow, count: 2 }],
      });
      await AlertHistory.create({
        alert: alert._id,
        createdAt: alertWindow,
        state: AlertState.ERROR,
        counts: 0,
        lastValues: [],
        errors: [makeError()],
      });

      // Window that was OK but the resolve notification failed → shows ERROR
      await AlertHistory.create({
        alert: alert._id,
        createdAt: okWindow,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: okWindow, count: 0 }],
      });
      await AlertHistory.create({
        alert: alert._id,
        createdAt: okWindow,
        state: AlertState.ERROR,
        counts: 0,
        lastValues: [],
        errors: [makeError()],
      });

      const histories = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
      });

      expect(histories).toHaveLength(2);
      expect(histories[0].state).toBe(AlertState.ALERT);
      // Errors from the ERROR row are still surfaced on the merged window
      expect(histories[0].errors).toHaveLength(1);
      expect(histories[1].state).toBe(AlertState.ERROR);
      expect(histories[1].errors).toHaveLength(1);
    });
  });

  describe('getAlertEvaluations', () => {
    const createAlert = async () => {
      const team = await Team.create({ name: 'Test Team' });
      return Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });
    };

    const createOkWindow = (alertId: any, createdAt: Date) =>
      AlertHistory.create({
        alert: alertId,
        createdAt,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: createdAt, count: 0 }],
      });

    it('only returns windows within [startTime, endTime]', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);

      await createOkWindow(alert._id, at(5)); // after endTime
      await createOkWindow(alert._id, at(15)); // in range
      await createOkWindow(alert._id, at(20)); // in range
      await createOkWindow(alert._id, at(40)); // before startTime

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: at(30),
        endTime: at(10),
      });

      expect(page.data).toHaveLength(2);
      expect(page.data[0].createdAt).toEqual(at(15));
      expect(page.data[1].createdAt).toEqual(at(20));
      expect(page.hasMore).toBe(false);
      expect(page.nextBefore).toBeUndefined();
    });

    it('paginates older windows via the nextBefore cursor when the page fills up', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const windows = [1, 2, 3, 4].map(i => new Date(now - i * 5 * 60_000));
      for (const createdAt of windows) {
        await createOkWindow(alert._id, createdAt);
      }

      const startTime = new Date(now - 60 * 60_000);
      const endTime = new Date(now);

      const firstPage = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 2,
        startTime,
        endTime,
      });
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.data[0].createdAt).toEqual(windows[0]);
      expect(firstPage.data[1].createdAt).toEqual(windows[1]);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextBefore).toEqual(windows[1]);

      const secondPage = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 2,
        startTime,
        endTime,
        before: firstPage.nextBefore,
      });
      expect(secondPage.data).toHaveLength(2);
      expect(secondPage.data[0].createdAt).toEqual(windows[2]);
      expect(secondPage.data[1].createdAt).toEqual(windows[3]);
    });

    it('keeps paging across gaps: the scan bound truncates but nextBefore advances', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);

      // One recent window, then a gap far wider than the per-request scan
      // bound ((limit + 1) × interval = 3 minutes for limit=2 / 1m interval),
      // then an old window still inside the requested range.
      await createOkWindow(alert._id, at(1));
      await createOkWindow(alert._id, at(20));

      const startTime = at(30);
      const endTime = at(0);

      // First page: finds the recent window; the scan bound stops long
      // before startTime, so more may exist.
      const firstPage = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '1m',
        limit: 2,
        startTime,
        endTime,
      });
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.data[0].createdAt).toEqual(at(1));
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextBefore).toBeDefined();

      // Follow the cursor until the old window is found or the range is
      // exhausted. Every hop advances by at least one scan bound, so this
      // terminates.
      let before = firstPage.nextBefore;
      let found: Date | undefined;
      for (let i = 0; i < 20 && before != null; i++) {
        const page = await getAlertEvaluations({
          alertId: new ObjectId(alert._id),
          interval: '1m',
          limit: 2,
          startTime,
          endTime,
          before,
        });
        if (page.data.length > 0) {
          found = page.data[0].createdAt;
          break;
        }
        expect(page.hasMore).toBe(true);
        // Empty pages still advance the cursor
        expect(page.nextBefore!.getTime()).toBeLessThan(before.getTime());
        before = page.nextBefore;
      }
      expect(found).toEqual(at(20));
    });

    it('reports hasMore=false once the scan reaches startTime', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);

      await createOkWindow(alert._id, at(5));

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: at(20),
        endTime: at(0),
      });

      expect(page.data).toHaveLength(1);
      expect(page.hasMore).toBe(false);
      expect(page.nextBefore).toBeUndefined();
      // Non-grouped rows carry no per-group breakdown
      expect(page.data[0].groups).toBeUndefined();
      expect(page.data[0].groupsTotal).toBeUndefined();
    });

    it('breaks grouped windows down per group, firing-first', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const windowStart = new Date(now - 5 * 60_000);
      const bucket = new Date(now - 10 * 60_000);

      const createGroupRow = (
        group: string,
        state: AlertState,
        count: number,
        fired?: boolean,
      ) =>
        AlertHistory.create({
          alert: alert._id,
          createdAt: windowStart,
          state,
          counts: state === AlertState.OK ? 0 : 1,
          lastValues: [{ startTime: bucket, count }],
          group,
          ...(fired != null && { fired }),
        });

      await createGroupRow('ServiceName:web', AlertState.OK, 3);
      await createGroupRow('ServiceName:api', AlertState.ALERT, 14, true);
      await createGroupRow('ServiceName:worker', AlertState.PENDING, 9);
      // A notification failure recorded for the window: contributes errors,
      // never a group entry.
      await AlertHistory.create({
        alert: alert._id,
        createdAt: windowStart,
        state: AlertState.ERROR,
        counts: 0,
        lastValues: [],
        errors: [
          {
            timestamp: new Date(),
            type: 'WEBHOOK_ERROR',
            message: 'Failed to send webhook notification.',
          },
        ],
      });

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: new Date(now - 60 * 60_000),
        endTime: new Date(now),
      });

      expect(page.data).toHaveLength(1);
      const window = page.data[0];
      // Overall window state merges the per-group states
      expect(window.state).toBe(AlertState.ALERT);
      expect(window.groupsTotal).toBe(3);
      expect(window.groups).toHaveLength(3);
      // Firing-first ordering: ALERT > PENDING > OK
      expect(window.groups!.map(g => g.group)).toEqual([
        'ServiceName:api',
        'ServiceName:worker',
        'ServiceName:web',
      ]);
      expect(window.groups![0]).toMatchObject({
        group: 'ServiceName:api',
        state: AlertState.ALERT,
        counts: 1,
        fired: true,
      });
      expect(window.groups![0].lastValue).toMatchObject({ count: 14 });
      expect(window.groups![2]).toMatchObject({
        group: 'ServiceName:web',
        state: AlertState.OK,
        counts: 0,
      });
      // The ERROR row surfaces as window errors, not as a group
      expect(window.errors).toHaveLength(1);
      expect(window.groups!.every(g => g.state !== AlertState.ERROR)).toBe(
        true,
      );
    });

    it('surfaces evaluation analytics, preferring the successful evaluation over a failed attempt', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const windowStart = new Date(now - 5 * 60_000);
      const bucket = new Date(now - 10 * 60_000);

      // Failed first attempt for this window (its query ran 300s)
      await AlertHistory.create({
        alert: alert._id,
        createdAt: windowStart,
        state: AlertState.ERROR,
        counts: 0,
        lastValues: [],
        errors: [
          {
            timestamp: new Date(),
            type: 'QUERY_TIMEOUT',
            message: 'timed out',
          },
        ],
        analytics: { queryDurationMs: 300_000 },
      });
      // Successful retry
      await AlertHistory.create({
        alert: alert._id,
        createdAt: windowStart,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: bucket, count: 1 }],
        analytics: {
          queryDurationMs: 1_200,
          webhookDurationMs: 340,
          backfilledBuckets: 0,
        },
      });

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: new Date(now - 60 * 60_000),
        endTime: new Date(now),
      });

      expect(page.data).toHaveLength(1);
      expect(page.data[0].analytics).toMatchObject({
        queryDurationMs: 1_200,
        webhookDurationMs: 340,
        backfilledBuckets: 0,
      });
    });

    it('falls back to the failed attempt analytics when no successful row exists', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const windowStart = new Date(now - 5 * 60_000);

      await AlertHistory.create({
        alert: alert._id,
        createdAt: windowStart,
        state: AlertState.ERROR,
        counts: 0,
        lastValues: [],
        errors: [
          {
            timestamp: new Date(),
            type: 'QUERY_TIMEOUT',
            message: 'timed out',
          },
        ],
        analytics: { queryDurationMs: 300_000 },
      });

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: new Date(now - 60 * 60_000),
        endTime: new Date(now),
      });

      expect(page.data).toHaveLength(1);
      expect(page.data[0].analytics).toMatchObject({
        queryDurationMs: 300_000,
        // Derived from lastValues (none) for rows lacking the field
        backfilledBuckets: 0,
      });
    });

    it('derives backfilled buckets from lastValues for rows written before analytics existed', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const windowStart = new Date(now - 5 * 60_000);
      const bucketAt = (minsAgo: number) => new Date(now - minsAgo * 60_000);

      // Legacy backfill row: one evaluation covering three buckets, no
      // analytics field.
      await AlertHistory.create({
        alert: alert._id,
        createdAt: windowStart,
        state: AlertState.OK,
        counts: 0,
        lastValues: [
          { startTime: bucketAt(20), count: 0 },
          { startTime: bucketAt(15), count: 0 },
          { startTime: bucketAt(10), count: 0 },
        ],
      });

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: new Date(now - 60 * 60_000),
        endTime: new Date(now),
      });

      expect(page.data).toHaveLength(1);
      expect(page.data[0].analytics).toEqual({ backfilledBuckets: 2 });
    });

    it('caps the per-group breakdown and reports the pre-cap total', async () => {
      const alert = await createAlert();
      const now = Date.now();
      const windowStart = new Date(now - 5 * 60_000);
      const bucket = new Date(now - 10 * 60_000);

      const total = ALERT_EVALUATION_GROUPS_LIMIT + 5;
      // One firing group buried among many OK groups: firing-first ordering
      // must keep it visible after the cap.
      const rows = Array.from({ length: total }, (_, i) => ({
        alert: alert._id,
        createdAt: windowStart,
        state: i === total - 1 ? AlertState.ALERT : AlertState.OK,
        counts: i === total - 1 ? 1 : 0,
        lastValues: [{ startTime: bucket, count: i }],
        group: `ServiceName:svc-${String(i).padStart(3, '0')}`,
      }));
      await AlertHistory.insertMany(rows);

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        limit: 10,
        startTime: new Date(now - 60 * 60_000),
        endTime: new Date(now),
      });

      expect(page.data).toHaveLength(1);
      const window = page.data[0];
      expect(window.groupsTotal).toBe(total);
      expect(window.groups).toHaveLength(ALERT_EVALUATION_GROUPS_LIMIT);
      expect(window.groups![0].state).toBe(AlertState.ALERT);
      expect(window.groups![0].group).toBe(
        `ServiceName:svc-${String(total - 1).padStart(3, '0')}`,
      );
    });
  });

  describe('getRecentAlertHistoriesBatch', () => {
    it('should return empty map when no alerts are provided', async () => {
      const result = await getRecentAlertHistoriesBatch([], 20);
      expect(result.size).toBe(0);
    });

    it('should return histories for multiple alerts in a single batch call', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert1 = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });
      const alert2 = await Alert.create({
        team: team._id,
        threshold: 200,
        interval: '5m',
        channel: { type: null },
      });

      const now = new Date(Date.now() - 60000);
      const earlier = new Date(Date.now() - 120000);

      await AlertHistory.create({
        alert: alert1._id,
        createdAt: now,
        state: AlertState.ALERT,
        counts: 5,
        lastValues: [{ startTime: now, count: 5 }],
      });
      await AlertHistory.create({
        alert: alert1._id,
        createdAt: earlier,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: earlier, count: 0 }],
      });
      await AlertHistory.create({
        alert: alert2._id,
        createdAt: now,
        state: AlertState.OK,
        counts: 1,
        lastValues: [{ startTime: now, count: 1 }],
      });

      const result = await getRecentAlertHistoriesBatch(
        [
          { alertId: new ObjectId(alert1._id), interval: '5m' },
          { alertId: new ObjectId(alert2._id), interval: '5m' },
        ],
        20,
      );

      expect(result.size).toBe(2);

      const alert1Histories = result.get(alert1._id.toString());
      expect(alert1Histories).toHaveLength(2);
      expect(alert1Histories![0].createdAt).toEqual(now);
      expect(alert1Histories![0].state).toBe(AlertState.ALERT);
      expect(alert1Histories![1].createdAt).toEqual(earlier);
      expect(alert1Histories![1].state).toBe(AlertState.OK);

      const alert2Histories = result.get(alert2._id.toString());
      expect(alert2Histories).toHaveLength(1);
      expect(alert2Histories![0].state).toBe(AlertState.OK);
      expect(alert2Histories![0].counts).toBe(1);
    });

    it('should return empty array for alerts with no history', async () => {
      const alertId = new ObjectId();

      const result = await getRecentAlertHistoriesBatch(
        [{ alertId, interval: '5m' }],
        20,
      );

      expect(result.size).toBe(1);
      expect(result.get(alertId.toString())).toEqual([]);
    });

    it('should respect the limit parameter per alert', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      // Create 5 histories
      for (let i = 0; i < 5; i++) {
        await AlertHistory.create({
          alert: alert._id,
          createdAt: new Date(Date.now() - i * 60000),
          state: AlertState.OK,
          counts: 0,
          lastValues: [
            { startTime: new Date(Date.now() - i * 60000), count: 0 },
          ],
        });
      }

      const result = await getRecentAlertHistoriesBatch(
        [{ alertId: new ObjectId(alert._id), interval: '5m' }],
        3,
      );

      expect(result.get(alert._id.toString())).toHaveLength(3);
    });

    it('should detect ALERT state when any grouped history has ALERT state', async () => {
      const team = await Team.create({ name: 'Test Team' });
      const alert = await Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });

      const timestamp = new Date(Date.now() - 60000);

      // Create histories with mixed states at the same timestamp
      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: timestamp, count: 0 }],
      });
      await AlertHistory.create({
        alert: alert._id,
        createdAt: timestamp,
        state: AlertState.ALERT,
        counts: 3,
        lastValues: [{ startTime: timestamp, count: 3 }],
      });

      const result = await getRecentAlertHistoriesBatch(
        [{ alertId: new ObjectId(alert._id), interval: '5m' }],
        20,
      );

      const histories = result.get(alert._id.toString());
      expect(histories).toHaveLength(1);
      expect(histories![0].state).toBe(AlertState.ALERT);
      expect(histories![0].counts).toBe(3);
    });
  });

  describe('getAlertTransitionsInRange', () => {
    // Minutes-ago helper so all fixtures stay recent (avoids the 30d TTL).
    const now = Date.now();
    const t = (minsAgo: number) => new Date(now - minsAgo * 60_000);

    const createAlert = async () => {
      const team = await Team.create({ name: 'Test Team' });
      return Alert.create({
        team: team._id,
        threshold: 100,
        interval: '5m',
        channel: { type: null },
      });
    };

    const createHistory = (
      alertId: any,
      createdAt: Date,
      state: AlertState,
      counts: number,
    ) =>
      AlertHistory.create({
        alert: alertId,
        createdAt,
        state,
        counts,
        lastValues: [{ startTime: createdAt, count: counts }],
      });

    it('returns empty array when no history exists', async () => {
      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(),
        interval: '5m',
        startTime: t(60),
        endTime: t(0),
      });
      expect(transitions).toEqual([]);
    });

    it('emits a firing and a recovery for an ALERT episode', async () => {
      const alert = await createAlert();
      await createHistory(alert._id, t(25), AlertState.OK, 0);
      await createHistory(alert._id, t(20), AlertState.ALERT, 7);
      await createHistory(alert._id, t(15), AlertState.ALERT, 8);
      await createHistory(alert._id, t(10), AlertState.OK, 0);

      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime: t(28),
        endTime: t(5),
      });

      expect(transitions).toHaveLength(2);
      expect(transitions[0].state).toBe(AlertState.ALERT);
      expect(transitions[0].createdAt).toBe(t(20).toISOString());
      expect(transitions[1].state).toBe(AlertState.OK);
      expect(transitions[1].createdAt).toBe(t(10).toISOString());
    });

    it('detects a firing at the range edge using the preceding window', async () => {
      const alert = await createAlert();
      // Window just before the range establishes the prior (non-firing) state.
      await createHistory(alert._id, t(30), AlertState.OK, 0);
      await createHistory(alert._id, t(25), AlertState.ALERT, 4);
      await createHistory(alert._id, t(20), AlertState.ALERT, 5);

      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime: t(27),
        endTime: t(5),
      });

      expect(transitions).toHaveLength(1);
      expect(transitions[0].state).toBe(AlertState.ALERT);
      expect(transitions[0].createdAt).toBe(t(25).toISOString());
    });

    it('emits a firing when history begins already in ALERT', async () => {
      // A freshly-created alert that is firing from its first evaluation: there
      // is no preceding non-ALERT window, but it should still be marked.
      const alert = await createAlert();
      await createHistory(alert._id, t(20), AlertState.ALERT, 1);
      await createHistory(alert._id, t(15), AlertState.ALERT, 1);

      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime: t(25),
        endTime: t(5),
      });

      expect(transitions).toHaveLength(1);
      expect(transitions[0].state).toBe(AlertState.ALERT);
      expect(transitions[0].createdAt).toBe(t(20).toISOString());
    });

    it('pins a carry-in firing marker to the range start when already firing on entry', async () => {
      // Firing before and throughout the range: a single firing marker should
      // appear at the range start, not at any interior window.
      const alert = await createAlert();
      await createHistory(alert._id, t(30), AlertState.ALERT, 5);
      await createHistory(alert._id, t(25), AlertState.ALERT, 5);
      await createHistory(alert._id, t(20), AlertState.ALERT, 5);

      const startTime = t(27);
      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime,
        endTime: t(5),
      });

      expect(transitions).toHaveLength(1);
      expect(transitions[0].state).toBe(AlertState.ALERT);
      expect(transitions[0].createdAt).toBe(startTime.toISOString());
    });

    it('pins a carry-in marker when no window falls inside the range', async () => {
      // Alert interval wider than the dashboard window: the only evaluation is
      // before startTime, so nothing lands in-range, but the alert is firing.
      const alert = await createAlert();
      await createHistory(alert._id, t(30), AlertState.ALERT, 1);

      const startTime = t(20);
      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '1h', // lookback reaches back past the t(30) window
        startTime,
        endTime: t(5),
      });

      expect(transitions).toHaveLength(1);
      expect(transitions[0].state).toBe(AlertState.ALERT);
      expect(transitions[0].createdAt).toBe(startTime.toISOString());
    });

    it('pins a carry-in firing then shows the in-range recovery', async () => {
      // Fired before the range and recovered inside it: without the carry-in
      // marker the recovery would appear orphaned.
      const alert = await createAlert();
      await createHistory(alert._id, t(30), AlertState.ALERT, 5); // before range
      await createHistory(alert._id, t(25), AlertState.ALERT, 5); // in range, firing
      await createHistory(alert._id, t(20), AlertState.OK, 0); // recovery in range

      const startTime = t(27);
      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime,
        endTime: t(5),
      });

      expect(transitions).toHaveLength(2);
      expect(transitions[0].state).toBe(AlertState.ALERT);
      expect(transitions[0].createdAt).toBe(startTime.toISOString());
      expect(transitions[1].state).toBe(AlertState.OK);
      expect(transitions[1].createdAt).toBe(t(20).toISOString());
    });

    it('treats PENDING as non-firing for boundary detection', async () => {
      const alert = await createAlert();
      await createHistory(alert._id, t(30), AlertState.OK, 0);
      await createHistory(alert._id, t(25), AlertState.PENDING, 2);
      await createHistory(alert._id, t(20), AlertState.ALERT, 6);
      await createHistory(alert._id, t(15), AlertState.PENDING, 1);

      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime: t(27),
        endTime: t(5),
      });

      expect(transitions.map(tr => tr.state)).toEqual([
        AlertState.ALERT,
        AlertState.OK,
      ]);
      expect(transitions[0].createdAt).toBe(t(20).toISOString());
      expect(transitions[1].createdAt).toBe(t(15).toISOString());
    });

    it('ignores ERROR windows so a failed evaluation mid-firing is not a recovery', async () => {
      const alert = await createAlert();
      await createHistory(alert._id, t(30), AlertState.OK, 0);
      await createHistory(alert._id, t(25), AlertState.ALERT, 3);
      // Evaluation failed mid-episode — must not read as a recovery + refire
      await createHistory(alert._id, t(20), AlertState.ERROR, 0);
      await createHistory(alert._id, t(15), AlertState.ALERT, 4);
      await createHistory(alert._id, t(10), AlertState.OK, 0);

      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: '5m',
        startTime: t(40),
        endTime: t(0),
      });

      expect(transitions.map(tr => tr.state)).toEqual([
        AlertState.ALERT,
        AlertState.OK,
      ]);
      expect(transitions[0].createdAt).toBe(t(25).toISOString());
      expect(transitions[1].createdAt).toBe(t(10).toISOString());
    });

    it('only considers history for the specified alert', async () => {
      const alert1 = await createAlert();
      const alert2 = await createAlert();
      await createHistory(alert1._id, t(30), AlertState.OK, 0);
      await createHistory(alert1._id, t(25), AlertState.ALERT, 3);
      // Noise on another alert must not leak in.
      await createHistory(alert2._id, t(25), AlertState.OK, 0);
      await createHistory(alert2._id, t(20), AlertState.ALERT, 9);

      const transitions = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert1._id),
        interval: '5m',
        startTime: t(27),
        endTime: t(5),
      });

      expect(transitions).toHaveLength(1);
      expect(transitions[0].state).toBe(AlertState.ALERT);
    });
  });
});
