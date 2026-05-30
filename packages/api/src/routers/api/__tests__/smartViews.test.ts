import mongoose from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';

describe('smart views router', () => {
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

  const dashboardView = {
    name: 'Checkout team',
    resource: 'dashboard' as const,
    rules: [{ kind: 'tag-includes' as const, tag: 'checkout' }],
    combinator: 'any' as const,
    ordering: 0,
    isShared: false,
  };

  it('round-trips a dashboard smart view through POST and GET', async () => {
    const create = await agent
      .post('/smart-views')
      .send(dashboardView)
      .expect(200);
    expect(create.body).toMatchObject(dashboardView);
    expect(create.body.id).toBeDefined();

    const list = await agent.get('/smart-views?resource=dashboard').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject(dashboardView);
  });

  it('filters list by resource discriminator', async () => {
    await agent.post('/smart-views').send(dashboardView).expect(200);
    await agent
      .post('/smart-views')
      .send({
        ...dashboardView,
        name: 'Errors search',
        resource: 'savedSearch',
      })
      .expect(200);

    const dashList = await agent
      .get('/smart-views?resource=dashboard')
      .expect(200);
    expect(dashList.body).toHaveLength(1);
    expect(dashList.body[0].resource).toBe('dashboard');

    const searchList = await agent
      .get('/smart-views?resource=savedSearch')
      .expect(200);
    expect(searchList.body).toHaveLength(1);
    expect(searchList.body[0].resource).toBe('savedSearch');
  });

  it('returns all resources when no resource query param is set', async () => {
    await agent.post('/smart-views').send(dashboardView).expect(200);
    await agent
      .post('/smart-views')
      .send({
        ...dashboardView,
        name: 'Errors search',
        resource: 'savedSearch',
      })
      .expect(200);

    const list = await agent.get('/smart-views').expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('patches name and rules and reflects the change on GET', async () => {
    const create = await agent
      .post('/smart-views')
      .send(dashboardView)
      .expect(200);
    const { id } = create.body;

    const patch = await agent
      .patch(`/smart-views/${id}`)
      .send({
        name: 'Checkout + payments',
        rules: [
          { kind: 'tag-includes', tag: 'checkout' },
          { kind: 'tag-includes', tag: 'payments' },
        ],
        combinator: 'all',
      })
      .expect(200);

    expect(patch.body.name).toBe('Checkout + payments');
    expect(patch.body.rules).toHaveLength(2);
    expect(patch.body.combinator).toBe('all');
  });

  it('deletes a smart view and removes it from the listing', async () => {
    const create = await agent
      .post('/smart-views')
      .send(dashboardView)
      .expect(200);
    const { id } = create.body;

    await agent.delete(`/smart-views/${id}`).expect(204);

    const list = await agent.get('/smart-views?resource=dashboard').expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 when patching a non-existent smart view', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await agent
      .patch(`/smart-views/${fakeId}`)
      .send({ name: 'never' })
      .expect(404);
  });

  it('returns 404 when deleting a non-existent smart view', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await agent.delete(`/smart-views/${fakeId}`).expect(404);
  });

  it('rejects a body missing required fields', async () => {
    await agent
      .post('/smart-views')
      .send({ name: 'no resource', rules: [], combinator: 'all', ordering: 0 })
      .expect(400);
  });

  it('rejects a body with an unknown rule kind', async () => {
    await agent
      .post('/smart-views')
      .send({
        ...dashboardView,
        rules: [{ kind: 'has-active-alerts' }],
      })
      .expect(400);
  });

  it('rejects a name longer than 120 chars', async () => {
    await agent
      .post('/smart-views')
      .send({ ...dashboardView, name: 'x'.repeat(121) })
      .expect(400);
  });

  it('isolates smart views between users on the same team', async () => {
    // Create a view as the default agent.
    const create = await agent
      .post('/smart-views')
      .send(dashboardView)
      .expect(200);
    const { id } = create.body;

    // A second login for another user (default `getLoggedInAgent`
    // creates a fresh user per call when an email is not pinned).
    const other = await getLoggedInAgent(server);

    // Second user's listing is empty.
    const otherList = await other.agent
      .get('/smart-views?resource=dashboard')
      .expect(200);
    expect(otherList.body).toHaveLength(0);

    // Second user cannot patch or delete the first user's view.
    await other.agent
      .patch(`/smart-views/${id}`)
      .send({ name: 'hijack' })
      .expect(404);
    await other.agent.delete(`/smart-views/${id}`).expect(404);
  });
});
