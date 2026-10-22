import * as orgApiKeyController from '@/controllers/orgApiKey';
import { createOrgApiKey } from '@/controllers/orgApiKey';
import { getLoggedInAgent, getServer } from '@/fixtures';
import Dashboard from '@/models/dashboard';
import OrgApiKey from '@/models/orgApiKey';
import User from '@/models/user';

describe('external api v2', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /api/v2', async () => {
    const { agent, user } = await getLoggedInAgent(server);
    const resp = await agent
      .get(`/api/v2`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);
    expect(resp.body.version).toEqual('v2');
    expect(resp.body.user._id).toEqual(user?._id.toString());
    expect(resp.body.user.email).toEqual(user?.email);
  });

  describe('org API keys', () => {
    const setup = async () => {
      const { agent, team, user } = await getLoggedInAgent(server);
      const { doc, key } = await createOrgApiKey(team._id, user._id, {
        description: 'terraform',
        expiry: '30d',
      });
      return { agent, team, user, doc, key };
    };

    it('GET /api/v2 returns the key service account as the user', async () => {
      const { agent, team, doc, key } = await setup();
      const resp = await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
      expect(resp.body.user).toMatchObject({
        _id: doc.serviceAccount.toString(),
        team: team._id.toString(),
        name: 'terraform',
        isServiceAccount: true,
      });
      expect(resp.body.user).not.toHaveProperty('accessKey');
    });

    it("rejects the service account's personal access key", async () => {
      const { agent, doc } = await setup();
      const account = await User.findById(doc.serviceAccount);
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${account?.accessKey}`)
        .expect(401);
    });

    it('lists only its own team data', async () => {
      const { agent, team, key } = await setup();
      await Dashboard.create({ name: 'mine', team: team._id, tiles: [] });
      await Dashboard.create({
        name: 'other',
        team: new Dashboard()._id,
        tiles: [],
      });
      const resp = await agent
        .get('/api/v2/dashboards')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
      expect(resp.body.data.map((d: { name: string }) => d.name)).toEqual([
        'mine',
      ]);
    });

    it('rejects expired and revoked keys', async () => {
      const { agent, doc, key } = await setup();
      await OrgApiKey.updateOne(
        { _id: doc._id },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);

      await OrgApiKey.deleteOne({ _id: doc._id });
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);
    });

    it('records last use', async () => {
      const { agent, doc, key } = await setup();
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
      let lastUsedAt: Date | null | undefined = null;
      for (let i = 0; i < 20 && lastUsedAt == null; i++) {
        await new Promise(r => setTimeout(r, 50));
        lastUsedAt = (await OrgApiKey.findById(doc._id))?.lastUsedAt;
      }
      expect(lastUsedAt).toBeInstanceOf(Date);
    });

    it('authenticates MCP requests and rejects revoked keys', async () => {
      const { agent, doc, key } = await setup();
      const listTools = () =>
        agent
          .post('/mcp')
          .set('Authorization', `Bearer ${key}`)
          .set('Accept', 'application/json, text/event-stream')
          .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

      const ok = await listTools();
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('clickstack_save_alert');

      await OrgApiKey.deleteOne({ _id: doc._id });
      expect((await listTools()).status).toBe(401);
    });

    it('responds with an error when the key lookup fails', async () => {
      const { agent, key } = await setup();
      jest
        .spyOn(orgApiKeyController, 'findActiveOrgApiKey')
        .mockRejectedValueOnce(new Error('mongo unavailable'));
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${key}`)
        .expect(500);
    });
  });
});
