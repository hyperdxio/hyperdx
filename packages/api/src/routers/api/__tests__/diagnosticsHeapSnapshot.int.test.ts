import { Readable } from 'node:stream';

import { getLoggedInAgent, getServer } from '@/fixtures';

jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  DIAGNOSTICS_ENABLED: true,
  DIAGNOSTICS_HEAP_SNAPSHOT_ENABLED: true,
}));

// A real snapshot of the test process is hundreds of MB; the route's gating,
// locking and streaming are what is under test here.
jest.mock('node:v8', () => ({
  ...jest.requireActual('node:v8'),
  getHeapSnapshot: () => Readable.from(['{"snapshot":{"meta":{}}}']),
}));

describe('diagnostics heap snapshot, when enabled', () => {
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

  it('streams the snapshot as an attachment', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.post('/diagnostics/heap-snapshot').expect(200);

    expect(resp.headers['content-disposition']).toContain('.heapsnapshot');
    expect(resp.body).toEqual({ snapshot: { meta: {} } });
  });
});
