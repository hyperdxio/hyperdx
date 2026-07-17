import mongoose from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';

describe('favorites router', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('can add a dashboard favorite', async () => {
    const resourceId = new mongoose.Types.ObjectId().toString();
    const res = await agent
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId })
      .expect(200);
    expect(res.body.resourceType).toBe('dashboard');
    expect(res.body.resourceId).toBe(resourceId);
  });

  it('can add a savedSearch favorite', async () => {
    const resourceId = new mongoose.Types.ObjectId().toString();
    const res = await agent
      .put('/favorites')
      .send({ resourceType: 'savedSearch', resourceId })
      .expect(200);
    expect(res.body.resourceType).toBe('savedSearch');
    expect(res.body.resourceId).toBe(resourceId);
  });

  it('can list favorites', async () => {
    const id1 = new mongoose.Types.ObjectId().toString();
    const id2 = new mongoose.Types.ObjectId().toString();
    await agent
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId: id1 })
      .expect(200);
    await agent
      .put('/favorites')
      .send({ resourceType: 'savedSearch', resourceId: id2 })
      .expect(200);

    const res = await agent.get('/favorites').expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((f: any) => f.resourceId).sort()).toEqual(
      [id1, id2].sort(),
    );
  });

  it('can remove a favorite', async () => {
    const resourceId = new mongoose.Types.ObjectId().toString();
    await agent
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId })
      .expect(200);

    await agent.delete(`/favorites/dashboard/${resourceId}`).expect(204);

    const res = await agent.get('/favorites').expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('adding duplicate favorite is idempotent', async () => {
    const resourceId = new mongoose.Types.ObjectId().toString();
    await agent
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId })
      .expect(200);
    await agent
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId })
      .expect(200);

    const res = await agent.get('/favorites').expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('removing non-existent favorite returns 204', async () => {
    const resourceId = new mongoose.Types.ObjectId().toString();
    await agent.delete(`/favorites/dashboard/${resourceId}`).expect(204);
  });

  it('rejects invalid resourceType', async () => {
    const resourceId = new mongoose.Types.ObjectId().toString();
    await agent
      .put('/favorites')
      .send({ resourceType: 'invalid', resourceId })
      .expect(400);
  });

  it('rejects invalid resourceId', async () => {
    await agent
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId: 'not-an-objectid' })
      .expect(400);
  });
});
