import mongoose from 'mongoose';
import request from 'supertest';

import { connectDB, getAgent, getServer } from '@/fixtures';
import opampApp from '@/opamp/app';

// Covers https://github.com/hyperdxio/hyperdx/issues/2966: `/health` is pure
// liveness and must stay 200 while the process serves HTTP, whereas `/ready`
// must reflect MongoDB connectivity so Kubernetes readiness probes can pull a
// pod that cannot serve Mongo-backed requests out of rotation.
describe('health and readiness endpoints', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /health returns 200 on the API server', async () => {
    const resp = await getAgent(server).get('/health').expect(200);
    expect(resp.body.data).toEqual('OK');
  });

  it('GET /health returns 200 on the OpAMP server', async () => {
    const resp = await request(opampApp).get('/health').expect(200);
    expect(resp.body).toEqual({ status: 'OK' });
  });

  it('GET /ready reflects Mongo connectivity on both servers', async () => {
    const agent = getAgent(server);

    // Connected: both readiness endpoints pass.
    const apiReady = await agent.get('/ready').expect(200);
    expect(apiReady.body.data).toEqual('OK');
    await request(opampApp).get('/ready').expect(200);

    await mongoose.disconnect();
    try {
      // Disconnected: readiness fails with the connection state ...
      const apiNotReady = await agent.get('/ready').expect(503);
      expect(apiNotReady.body).toEqual({
        status: 'unavailable',
        mongo: 'disconnected',
      });
      const opampNotReady = await request(opampApp).get('/ready').expect(503);
      expect(opampNotReady.body).toEqual({
        status: 'unavailable',
        mongo: 'disconnected',
      });

      // ... while liveness stays green — restarting would not fix Mongo.
      await agent.get('/health').expect(200);
      await request(opampApp).get('/health').expect(200);
    } finally {
      // Restore the connection for teardown.
      await connectDB();
    }

    await agent.get('/ready').expect(200);
    await request(opampApp).get('/ready').expect(200);
  });
});
