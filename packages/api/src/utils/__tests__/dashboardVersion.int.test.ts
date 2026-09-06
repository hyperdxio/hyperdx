import mongoose from 'mongoose';

import { getLoggedInAgent, getServer, makeTile } from '@/fixtures';
import Dashboard from '@/models/dashboard';
import {
  resolveDashboardWriteMiss,
  versionToken,
} from '@/utils/dashboardVersion';

describe('dashboard version (integration)', () => {
  const server = getServer();
  let team: any;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const create = () =>
    new Dashboard({
      name: 'Version Test',
      tiles: [makeTile()],
      tags: [],
      team: team._id,
    }).save();

  describe('the updatedAt invariant', () => {
    // The entire optimistic-concurrency scheme depends on updatedAt being
    // server-owned. The internal PATCH body already echoes a stale
    // updatedAt back from the client, so if mongoose ever honoured it the
    // token would freeze and every guard would pass. Pin it here.
    it('ignores a client-supplied updatedAt and sets its own', async () => {
      const dashboard = await create();
      const stale = new Date('2000-01-01T00:00:00.000Z');

      const updated = await Dashboard.findOneAndUpdate(
        { _id: dashboard._id, team: team._id },
        { name: 'Renamed', updatedAt: stale },
        { new: true },
      );

      expect(updated!.updatedAt.getTime()).not.toBe(stale.getTime());
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        dashboard.updatedAt.getTime(),
      );
    });

    it('bumps updatedAt on a $set update', async () => {
      const dashboard = await create();
      const before = versionToken(dashboard);

      // Mongo stores millisecond precision, so a same-millisecond write
      // would produce an identical token and make this test flaky.
      await new Promise(resolve => setTimeout(resolve, 5));

      const updated = await Dashboard.findOneAndUpdate(
        { _id: dashboard._id, team: team._id },
        { $set: { name: 'Renamed' } },
        { new: true },
      );

      expect(versionToken(updated!)).not.toBe(before);
    });
  });

  describe('resolveDashboardWriteMiss', () => {
    it('reports a conflict with the current version when the dashboard exists', async () => {
      const dashboard = await create();

      const miss = await resolveDashboardWriteMiss(
        dashboard._id.toString(),
        team._id,
      );

      expect(miss).toEqual({
        kind: 'conflict',
        currentVersion: versionToken(dashboard),
      });
    });

    it('reports deleted when the dashboard is gone', async () => {
      const dashboard = await create();
      const id = dashboard._id.toString();
      await Dashboard.deleteOne({ _id: id });

      expect(await resolveDashboardWriteMiss(id, team._id)).toEqual({
        kind: 'deleted',
      });
    });

    it('reports deleted for a dashboard belonging to another team', async () => {
      const dashboard = await create();
      // Registration is single-tenant (isTeamExisting gates a second
      // self-registration), so a second team is synthesised directly
      // rather than via a second getLoggedInAgent call.
      const otherTeamId = new mongoose.Types.ObjectId();

      expect(
        await resolveDashboardWriteMiss(dashboard._id.toString(), otherTeamId),
      ).toEqual({ kind: 'deleted' });
    });
  });
});
