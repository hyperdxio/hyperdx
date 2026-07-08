import { ObjectId } from 'mongodb';

import {
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
