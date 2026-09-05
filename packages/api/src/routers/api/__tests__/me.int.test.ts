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
    it('returns the calling user', async () => {
      const { agent, team, user } = await getLoggedInAgent(server);

      const resp = await agent.get('/me').expect(200);

      expect(resp.body.id).toEqual(user._id.toString());
      expect(resp.body.email).toEqual('fake@deploysentinel.com');
      expect(resp.body.accessKey).toEqual(user.accessKey);
      expect(resp.body.team.id).toEqual(team._id.toString());
    });

    it('rejects an unauthenticated request', async () => {
      await getAgent(server).get('/me').expect(401);
    });
  });

  describe('PATCH /me/accessKey', () => {
    it('rejects an unauthenticated request', async () => {
      // The new verb is covered by the mount-time isUserAuthenticated in
      // api-app.ts, not by anything in the handler itself.
      await getAgent(server).patch('/me/accessKey').expect(401);
    });

    it('returns a new key and persists it', async () => {
      const { agent, user } = await getLoggedInAgent(server);

      const resp = await agent.patch('/me/accessKey').expect(200);

      expect(resp.body.newAccessKey).toEqual(expect.any(String));
      expect(resp.body.newAccessKey).not.toEqual(user.accessKey);
      expect((await User.findById(user._id))?.accessKey).toEqual(
        resp.body.newAccessKey,
      );
    });

    it('revokes the old key and accepts the new one', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      const oldAccessKey = user.accessKey;

      // GET /api/v2 is the bearer-authed surface with no rate limiter attached,
      // so three sequential calls here are safe.
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${oldAccessKey}`)
        .expect(200);

      const { body } = await agent.patch('/me/accessKey').expect(200);

      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${oldAccessKey}`)
        .expect(401);
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${body.newAccessKey}`)
        .expect(200);
    });

    it('does not sign the user out of their browser session', async () => {
      // Session auth never reads accessKey (see isUserAuthenticated), so
      // rotating must leave the cookie session intact.
      const { agent } = await getLoggedInAgent(server);

      const { body } = await agent.patch('/me/accessKey').expect(200);

      const resp = await agent.get('/me').expect(200);
      expect(resp.body.accessKey).toEqual(body.newAccessKey);
    });

    it("does not touch another user's key", async () => {
      const { agent, user } = await getLoggedInAgent(server);
      // Created directly rather than via /register/password, which is gated to
      // the first user. We only read the schema-defaulted accessKey off it.
      const other = await User.create({
        email: 'other@deploysentinel.com',
        team: user.team,
      });

      await agent.patch('/me/accessKey').expect(200);

      expect((await User.findById(other._id))?.accessKey).toEqual(
        other.accessKey,
      );
    });
  });
});
