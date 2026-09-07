import mongoose from 'mongoose';

import { getServer, randomMongoId } from '@/fixtures';
import { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { unaddressableTileAlertIds } from '@/utils/iacTileAlerts';

describe('unaddressableTileAlertIds', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const tile = (id: string, name: string) => ({
    id,
    x: 0,
    y: 0,
    w: 4,
    h: 2,
    config: { name, displayType: 'line' },
  });

  // Shaped like the lean rows the manifest router passes in.
  const alert = (dashboard: mongoose.Types.ObjectId, tileId: string) => ({
    _id: new mongoose.Types.ObjectId(),
    source: AlertSource.TILE,
    dashboard,
    tileId,
  });

  it('withholds every tile alert when the dashboard read fails', async () => {
    const teamId = randomMongoId();
    const dashboard = await Dashboard.create({
      name: 'Ops',
      team: teamId,
      tiles: [tile('tile-1', 'Errors')],
    });
    const alerts = [
      alert(dashboard._id, 'tile-1'),
      alert(dashboard._id, 'tile-1'),
    ];

    // The failure this guards is MaxTimeMSExpired on a read sequenced last on
    // a shared budget. Reproducing that needs a slow collection, so the read
    // itself is made to reject instead.
    const find = jest.spyOn(Dashboard, 'find').mockReturnValue({
      maxTimeMS: () => ({
        lean: () => Promise.reject(new Error('MaxTimeMSExpired')),
      }),
    } as never);

    try {
      const withheld = await unaddressableTileAlertIds({
        teamId,
        alerts,
        maxTimeMS: 1_000,
      });

      // Fails closed: the manifest still answers, minus every tile alert.
      expect([...withheld].sort()).toEqual(
        alerts.map(a => a._id.toString()).sort(),
      );
    } finally {
      find.mockRestore();
    }
  });

  it('withholds nothing addressable once the read succeeds', async () => {
    const teamId = randomMongoId();
    const dashboard = await Dashboard.create({
      name: 'Ops',
      team: teamId,
      tiles: [tile('tile-1', 'Errors')],
    });

    const withheld = await unaddressableTileAlertIds({
      teamId,
      alerts: [alert(dashboard._id, 'tile-1')],
      maxTimeMS: 1_000,
    });

    expect([...withheld]).toEqual([]);
  });
});
