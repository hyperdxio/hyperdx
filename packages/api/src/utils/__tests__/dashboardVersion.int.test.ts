import mongoose from 'mongoose';

import { getLoggedInAgent, getServer, makeTile } from '@/fixtures';
import Dashboard from '@/models/dashboard';
import {
  resolveDashboardWriteMiss,
  versionFilter,
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

  describe('the version invariant', () => {
    // The entire optimistic-concurrency scheme depends on `version` being
    // bumped by the schema middleware on every write path, and on a
    // client-supplied `version` being ignored rather than honoured (or
    // erroring — `$set` and `$inc` on the same path is a hard Mongo error).
    // This is the single most important test in the change: if the
    // middleware silently stopped firing, every other test that exercises
    // it through an API route would still pass, since they only ever send
    // a version that happens to already be current.

    it('bumps version on a findOneAndUpdate', async () => {
      const dashboard = await create();
      expect(dashboard.version).toBe(0);

      const updated = await Dashboard.findOneAndUpdate(
        { _id: dashboard._id, team: team._id },
        { $set: { name: 'Renamed' } },
        { new: true },
      );

      expect(updated!.version).toBe(1);
    });

    it('bumps version on save() of an existing document', async () => {
      const dashboard = await create();
      expect(dashboard.version).toBe(0);

      dashboard.name = 'Renamed';
      const saved = await dashboard.save();

      expect(saved.version).toBe(1);
    });

    it('does not double-count version on save() of a new document', async () => {
      const dashboard = await create();
      expect(dashboard.version).toBe(0);
    });

    it('bumps version on a provisioning-style upsert', async () => {
      const dashboard = await create();

      const result = await Dashboard.findOneAndUpdate(
        { name: dashboard.name, team: team._id },
        {
          $set: { tiles: [makeTile()] },
          $setOnInsert: { name: dashboard.name, team: team._id },
        },
        { upsert: true, new: true },
      );

      expect(result!.version).toBe(1);
    });

    it('bumps version on a fresh insert via a provisioning-style upsert', async () => {
      const result = await Dashboard.findOneAndUpdate(
        { name: 'Never Existed', team: team._id },
        {
          $set: { tiles: [makeTile()] },
          $setOnInsert: { name: 'Never Existed', team: team._id },
        },
        { upsert: true, new: true },
      );

      // $inc on a missing field sets it, so a freshly-inserted document
      // starts at 1 rather than the schema default of 0. That's a
      // cosmetic difference from a plain `new Dashboard().save()` (which
      // starts at 0) — the token is opaque, so nothing depends on the
      // starting value itself, only on it changing on every subsequent
      // write.
      expect(result!.version).toBe(1);
    });

    it('ignores a client-supplied version on $set and does not error', async () => {
      const dashboard = await create();

      const updated = await Dashboard.findOneAndUpdate(
        { _id: dashboard._id, team: team._id },
        { $set: { name: 'Renamed', version: 999 } },
        { new: true },
      );

      expect(updated!.version).toBe(1);
    });

    it('ignores a client-supplied top-level version and does not error', async () => {
      const dashboard = await create();

      const updated = await Dashboard.findOneAndUpdate(
        { _id: dashboard._id, team: team._id },
        { name: 'Renamed', version: 999 },
        { new: true },
      );

      expect(updated!.version).toBe(1);
    });
  });

  describe('a document that predates the version field', () => {
    // Inserted with the native driver so mongoose's `pre('save')`/schema
    // default never runs — this is what every dashboard created before this
    // change actually looks like in MongoDB, not what `new Dashboard().save()`
    // would give us.
    const insertPreVersionDashboard = async () => {
      const { insertedId } = await Dashboard.collection.insertOne({
        name: 'Pre-Version Dashboard',
        tiles: [makeTile()],
        tags: [],
        team: team._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return insertedId;
    };

    it('accepts a guarded write with token "0" and bumps version to 1', async () => {
      const id = await insertPreVersionDashboard();

      const updated = await Dashboard.findOneAndUpdate(
        { _id: id, team: team._id, ...versionFilter(0) },
        { $set: { name: 'Renamed' } },
        { new: true },
      );

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
      expect(updated!.version).toBe(1);
    });
  });

  describe('resolveDashboardWriteMiss', () => {
    it('reports a conflict with the current version when the dashboard exists', async () => {
      const dashboard = await create();

      const miss = await resolveDashboardWriteMiss(
        dashboard._id.toString(),
        team._id,
        'internal_patch',
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

      expect(
        await resolveDashboardWriteMiss(id, team._id, 'internal_patch'),
      ).toEqual({
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
        await resolveDashboardWriteMiss(
          dashboard._id.toString(),
          otherTeamId,
          'internal_patch',
        ),
      ).toEqual({ kind: 'deleted' });
    });
  });
});
