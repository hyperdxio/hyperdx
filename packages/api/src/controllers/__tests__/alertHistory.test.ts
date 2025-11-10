import { ObjectId } from 'mongodb';

import { getRecentAlertHistories } from '@/controllers/alertHistory';
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

      const now = new Date('2024-01-15T12:00:00Z');
      const earlier = new Date('2024-01-15T11:00:00Z');

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

      const timestamp = new Date('2024-01-15T12:00:00Z');

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

      const timestamp = new Date('2024-01-15T12:00:00Z');

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

      const timestamp = new Date('2024-01-15T12:00:00Z');

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

      const oldest = new Date('2024-01-15T10:00:00Z');
      const middle = new Date('2024-01-15T11:00:00Z');
      const newest = new Date('2024-01-15T12:00:00Z');

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

      const timestamp = new Date('2024-01-15T12:00:00Z');
      const older = new Date('2024-01-15T11:00:00Z');
      const newer = new Date('2024-01-15T13:00:00Z');

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

      const timestamp = new Date('2024-01-15T12:00:00Z');

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
        limit: 10,
      });

      expect(histories).toHaveLength(1);
      expect(histories[0].state).toBe(AlertState.ALERT);
      expect(histories[0].counts).toBe(5);
    });
  });
});
