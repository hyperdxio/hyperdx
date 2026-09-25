import { once } from 'node:events';
import os from 'node:os';
import { Worker } from 'node:worker_threads';

import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import * as instrumentation from '@/utils/instrumentation';

jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  DIAGNOSTICS_ENABLED: true,
}));

describe('diagnostics router', () => {
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

  it('rejects unauthenticated requests', async () => {
    await getAgent(server).get('/diagnostics/report').expect(401);
  });

  it('returns a process report without environment variables', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/diagnostics/report').expect(200);

    expect(resp.body).toMatchObject({
      pid: process.pid,
      hostname: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
    expect(resp.body.report.header).toBeDefined();
    expect(resp.body.report.environmentVariables).toBeUndefined();
    expect(JSON.stringify(resp.body)).not.toContain(
      process.env.MONGO_URI ?? 'mongodb://',
    );
  });

  it('strips environment variables from worker thread reports too', async () => {
    const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
    await once(worker, 'online');
    try {
      const { agent } = await getLoggedInAgent(server);

      const resp = await agent.get('/diagnostics/report').expect(200);

      expect(resp.body.report.workers.length).toBeGreaterThan(0);
      expect(JSON.stringify(resp.body)).not.toContain('environmentVariables');
    } finally {
      await worker.terminate();
    }
  });

  it('leaves infrastructure detail out of the report', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/diagnostics/report').expect(200);

    const body = JSON.stringify(resp.body);
    for (const key of [
      'networkInterfaces',
      'commandLine',
      'remoteEndpoint',
      'localEndpoint',
    ]) {
      expect(body).not.toContain(`"${key}"`);
    }
  });

  it('rate-limits each user', async () => {
    const { agent } = await getLoggedInAgent(server);

    for (let i = 0; i < 10; i++) {
      await agent.get('/diagnostics/report').expect(200);
    }
    await agent.get('/diagnostics/report').expect(429);
  });

  it('returns a CPU profile for the requested window', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent
      .post('/diagnostics/cpu-profile?seconds=1')
      .expect(200);

    expect(resp.headers['content-disposition']).toContain('.cpuprofile');
    expect(resp.headers['x-hdx-diagnostics-source']).toBe(
      `${os.hostname()}/${process.pid}`,
    );
    expect(resp.headers['content-disposition']).toContain(
      `api-${os.hostname()}-${process.pid}.cpuprofile`,
    );
    expect(resp.body.nodes.length).toBeGreaterThan(0);
    expect(resp.body.startTime).toEqual(expect.any(Number));
  });

  it('returns a sampling heap profile', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent
      .post('/diagnostics/heap-profile?seconds=1')
      .expect(200);

    expect(resp.headers['content-disposition']).toContain('.heapprofile');
    expect(resp.body.head).toBeDefined();
  });

  it.each(['abc', '0', '-5', '51', '1.5'])(
    'rejects seconds=%s',
    async seconds => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post(`/diagnostics/cpu-profile?seconds=${seconds}`)
        .expect(400);
    },
  );

  it('rejects a second profile while one is running', async () => {
    const { agent } = await getLoggedInAgent(server);

    const first = agent.post('/diagnostics/cpu-profile?seconds=2').then(r => r);
    // Give the first request time to take the lock.
    await new Promise(resolve => setTimeout(resolve, 300));
    const busy = await agent
      .post('/diagnostics/heap-profile?seconds=1')
      .expect(409);
    expect(busy.body.message).toBe(
      'A profile is already running on this process',
    );
    expect((await first).status).toBe(200);

    // The lock is released once the first profile finishes.
    await agent.post('/diagnostics/heap-profile?seconds=1').expect(200);
  });

  it('releases the profiling lock when the client disconnects', async () => {
    const { agent } = await getLoggedInAgent(server);

    const abandoned = agent.post('/diagnostics/cpu-profile?seconds=30');
    void abandoned.end(() => {});
    await new Promise(resolve => setTimeout(resolve, 300));
    // superagent's abort() leaves the socket open; destroy it like a real client drop.
    (abandoned as unknown as { req: { destroy(): void } }).req.destroy();
    await new Promise(resolve => setTimeout(resolve, 300));

    await agent.post('/diagnostics/heap-profile?seconds=1').expect(200);
  });

  it('does not count a disconnect or a busy lock as a failed operation', async () => {
    const recordOutcome = jest.spyOn(instrumentation, 'recordOperationOutcome');
    const { agent } = await getLoggedInAgent(server);

    const abandoned = agent.post('/diagnostics/cpu-profile?seconds=30');
    void abandoned.end(() => {});
    await new Promise(resolve => setTimeout(resolve, 300));
    await agent.post('/diagnostics/heap-profile?seconds=1').expect(409);
    (abandoned as unknown as { req: { destroy(): void } }).req.destroy();
    await new Promise(resolve => setTimeout(resolve, 300));

    await agent.post('/diagnostics/heap-profile?seconds=1').expect(200);

    try {
      const outcomes = recordOutcome.mock.calls
        .map(([args]) => args)
        .filter(args => args.operation === 'diagnostics.collect');
      expect(outcomes).toEqual([
        expect.objectContaining({
          operation: 'diagnostics.collect',
          outcome: 'success',
          attributes: { kind: 'heap-profile' },
        }),
      ]);
    } finally {
      recordOutcome.mockRestore();
    }
  });

  it('keeps heap snapshots off unless enabled', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent.post('/diagnostics/heap-snapshot').expect(404);
  });
});
