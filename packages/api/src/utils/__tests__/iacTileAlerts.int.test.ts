import mongoose from 'mongoose';

import { getServer, randomMongoId } from '@/fixtures';
import { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { unaddressableTileAlertIds } from '@/utils/iacTileAlerts';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

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

  // A floor under the remaining budget was the alternative, and it would have
  // let a request that already spent the ceiling run past it.
  it('withholds every tile alert without reading when the budget is spent', async () => {
    const teamId = randomMongoId();
    const dashboard = await Dashboard.create({
      name: 'Ops',
      team: teamId,
      tiles: [tile('tile-1', 'Errors')],
    });
    const alerts = [alert(dashboard._id, 'tile-1')];
    const find = jest.spyOn(Dashboard, 'find');

    try {
      const withheld = await unaddressableTileAlertIds({
        teamId,
        alerts,
        maxTimeMS: 0,
      });

      expect([...withheld]).toEqual([alerts[0]._id.toString()]);
      // The point of skipping: mongo reads maxTimeMS 0 as "no limit".
      expect(find).not.toHaveBeenCalled();
    } finally {
      find.mockRestore();
    }
  });

  // maxTimeMS only caps mongo's own execution, so a read stuck waiting on a
  // pool connection or a socket would otherwise run past the request ceiling.
  it('withholds every tile alert when the read outlasts the budget', async () => {
    const teamId = randomMongoId();
    const dashboard = await Dashboard.create({
      name: 'Ops',
      team: teamId,
      tiles: [tile('tile-1', 'Errors')],
    });
    const alerts = [alert(dashboard._id, 'tile-1')];

    // Never settles, which is the shape of a wait maxTimeMS cannot see.
    const find = jest.spyOn(Dashboard, 'find').mockReturnValue({
      maxTimeMS: () => ({ lean: () => new Promise(() => {}) }),
    } as never);

    try {
      const withheld = await unaddressableTileAlertIds({
        teamId,
        alerts,
        maxTimeMS: 50,
      });

      expect([...withheld]).toEqual([alerts[0]._id.toString()]);
    } finally {
      find.mockRestore();
    }
  });

  // The timer gives up first and the read it raced rejects afterwards. One
  // request withholds one export, so that is one counter tick — but two logs,
  // because the late error names the failure the timeout could only guess at.
  it('logs the late read failure but counts the request once', async () => {
    const teamId = randomMongoId();
    const dashboard = await Dashboard.create({
      name: 'Ops',
      team: teamId,
      tiles: [tile('tile-1', 'Errors')],
    });
    const alerts = [alert(dashboard._id, 'tile-1')];

    const find = jest.spyOn(Dashboard, 'find').mockReturnValue({
      maxTimeMS: () => ({
        lean: () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MongoNetworkError')), 100),
          ),
      }),
    } as never);
    // getCounter memoizes by name, so this is the instrument the module under
    // test captured at import — no options, or it would warn about a mismatch.
    const add = jest.spyOn(
      getCounter('hyperdx.iac.tile_alert_lookup_failed'),
      'add',
    );
    const warn = jest.spyOn(logger, 'warn');

    try {
      const withheld = await unaddressableTileAlertIds({
        teamId,
        alerts,
        maxTimeMS: 20,
      });
      expect([...withheld]).toEqual([alerts[0]._id.toString()]);

      // Outlive the rejection the timer already walked away from.
      await new Promise(resolve => setTimeout(resolve, 250));

      const withholds = warn.mock.calls.filter(([arg]) =>
        JSON.stringify(arg).includes('tile-alert addressability'),
      );
      expect(withholds).toHaveLength(2);
      expect(add).toHaveBeenCalledTimes(1);
    } finally {
      find.mockRestore();
      add.mockRestore();
      warn.mockRestore();
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
