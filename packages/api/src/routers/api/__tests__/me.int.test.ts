import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import User from '@/models/user';

describe('me router', () => {
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

  describe('GET /me', () => {
    it('returns an empty lab set for a user that has never opted in', async () => {
      const { agent } = await getLoggedInAgent(server);

      const resp = await agent.get('/me').expect(200);

      // `labs` is absent on the document; the route normalizes it so the client
      // never has to distinguish "no field" from "nothing enabled".
      expect(resp.body.labs).toEqual({});
    });
  });

  describe('PATCH /me/labs', () => {
    it('persists an opt-in and reflects it on GET /me', async () => {
      const { agent } = await getLoggedInAgent(server);

      const patchResp = await agent
        .patch('/me/labs')
        .send({ labs: { 'my-lab': true } })
        .expect(200);

      expect(patchResp.body).toEqual({ labs: { 'my-lab': true } });

      const meResp = await agent.get('/me').expect(200);
      expect(meResp.body.labs).toEqual({ 'my-lab': true });
    });

    it('serializes labs as a plain object', async () => {
      // Regression guard for the storage type. A Mongoose Map's toJSON()
      // returns a native Map unless given { flattenMaps: true }, which
      // JSON.stringify renders as `{}` — so a future switch away from Mixed
      // would silently start returning nothing. See models/webhook.ts.
      const { agent } = await getLoggedInAgent(server);

      await agent
        .patch('/me/labs')
        .send({ labs: { 'lab-one': true, 'lab-two': true } })
        .expect(200);

      const resp = await agent.get('/me').expect(200);

      expect(typeof resp.body.labs).toBe('object');
      expect(Array.isArray(resp.body.labs)).toBe(false);
      expect(resp.body.labs).toEqual({ 'lab-one': true, 'lab-two': true });
      expect(Object.keys(resp.body.labs).sort()).toEqual([
        'lab-one',
        'lab-two',
      ]);
    });

    it('replaces the whole set rather than merging', async () => {
      // Full-replace is what makes ids from retired labs self-pruning.
      const { agent } = await getLoggedInAgent(server);

      await agent
        .patch('/me/labs')
        .send({ labs: { 'lab-a': true, 'lab-b': true } })
        .expect(200);

      await agent
        .patch('/me/labs')
        .send({ labs: { 'lab-a': true } })
        .expect(200);

      const resp = await agent.get('/me').expect(200);
      expect(resp.body.labs).toEqual({ 'lab-a': true });
    });

    it.each([
      ['an underscore', { my_lab: true }],
      ['uppercase', { 'My-Lab': true }],
      ['a dotted path', { 'a.b': true }],
      ['a mongo operator', { $set: true }],
      ['a leading dash', { '-lab': true }],
      ['an empty id', { '': true }],
    ])('rejects a lab id containing %s', async (_label, labs) => {
      const { agent } = await getLoggedInAgent(server);

      await agent.patch('/me/labs').send({ labs }).expect(400);
    });

    it('rejects __proto__ as a lab id without polluting Object.prototype', async () => {
      const { agent } = await getLoggedInAgent(server);

      // Sent as a raw JSON string so `__proto__` arrives as an own property,
      // which is how express.json() parses it off the wire.
      await agent
        .patch('/me/labs')
        .set('Content-Type', 'application/json')
        .send('{"labs":{"__proto__":true}}')
        .expect(400);

      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
      expect({}).not.toHaveProperty('labs');
    });

    it('rejects a non-boolean value', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .patch('/me/labs')
        .send({ labs: { 'lab-a': 'true' } })
        .expect(400);
    });

    it('rejects more lab entries than a user may store', async () => {
      const { agent } = await getLoggedInAgent(server);

      const tooMany: Record<string, boolean> = {};
      for (let i = 0; i < 65; i++) {
        tooMany[`lab-${i}`] = true;
      }

      await agent.patch('/me/labs').send({ labs: tooMany }).expect(400);
    });

    it('rejects an unauthenticated request', async () => {
      const anon = getAgent(server);

      await anon
        .patch('/me/labs')
        .send({ labs: { 'lab-a': true } })
        .expect(401);
    });

    it('scopes the write to the requesting user, not the team', async () => {
      // The second user is created directly rather than via getLoggedInAgent:
      // POST /register/password refuses once a team exists, so a second session
      // would need the invite flow. The concern here is only that the $set
      // targets req.user._id, which this covers.
      const { agent, team, user: userA } = await getLoggedInAgent(server);
      const userB = await User.create({
        email: 'second@example.com',
        name: 'Second',
        team: team._id,
      });

      await agent
        .patch('/me/labs')
        .send({ labs: { 'lab-a': true } })
        .expect(200);

      const storedA = await User.findById(userA._id);
      expect(storedA?.labs).toEqual({ 'lab-a': true });

      const storedB = await User.findById(userB._id);
      expect(storedB?.labs).toBeUndefined();
    });
  });
});
