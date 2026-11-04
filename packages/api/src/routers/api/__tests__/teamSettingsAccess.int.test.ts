import mongoose from 'mongoose';
import request from 'supertest';

import app from '@/api-app';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import {
  callTool,
  createTestClient,
  getFirstText,
} from '@/mcp/__tests__/mcpTestUtils';
import Team from '@/models/team';
import User from '@/models/user';
import Webhook from '@/models/webhook';

describe('team settings access', () => {
  beforeAll(connectDB);
  afterEach(clearDBCollections);
  afterAll(closeDB);

  async function login() {
    const agent = request.agent(app);
    const credentials = {
      email: 'member@example.com',
      password: 'TacoCat!2#4X',
    };
    await agent
      .post('/register/password')
      .send({ ...credentials, confirmPassword: credentials.password })
      .expect(200);
    await agent.post('/login/password').send(credentials).expect(303);
    const user = await User.findOne({ email: credentials.email }).orFail();
    return { agent, user };
  }

  it('preserves access for teams without a configured restriction', async () => {
    const { agent } = await login();
    await agent.get('/team/members').expect(200);
    expect(
      (await agent.get('/me').expect(200)).body.canManageTeamSettings,
    ).toBe(true);
  });

  it('grants access only to configured IDs and observes permission removal immediately', async () => {
    const { agent, user } = await login();
    await Team.collection.updateOne(
      { _id: user.team },
      { $set: { settingsAdminIds: [user._id] } },
    );
    expect(
      (await agent.get('/me').expect(200)).body.canManageTeamSettings,
    ).toBe(true);
    await agent
      .post('/team/invitation')
      .send({ email: 'invite@example.com' })
      .expect(200);
    await Team.collection.updateOne(
      { _id: user.team },
      { $set: { settingsAdminIds: [] } },
    );
    expect(
      (await agent.get('/me').expect(200)).body.canManageTeamSettings,
    ).toBe(false);
    await agent.get('/team/members').expect(403);
  });

  it('does not borrow permission from another team', async () => {
    const { agent, user } = await login();
    await Team.collection.updateOne(
      { _id: user.team },
      { $set: { settingsAdminIds: [] } },
    );
    await Team.collection.insertOne({
      _id: new mongoose.Types.ObjectId(),
      name: 'Other',
      settingsAdminIds: [user._id],
    });
    await agent.get('/team/members').expect(403);
  });

  it.each(['', '/api/v2'])(
    'allows administrator writes through %s and preserves resources after access is revoked',
    async prefix => {
      const { agent, user } = await login();
      await Team.updateOne(
        { _id: user.team },
        { $set: { settingsAdminIds: [user._id] } },
      );
      const client = prefix ? request(app) : agent;
      const webhook = {
        name: 'Alerts',
        service: 'generic',
        url: 'https://example.com/hook',
      };
      await client
        .post(`${prefix}/webhooks`)
        .set('Authorization', `Bearer ${user.accessKey}`)
        .send(webhook)
        .expect(200);
      const stored = await Webhook.findOne({ team: user.team }).orFail();
      expect(stored.url).toBe(webhook.url);
      const path = `${prefix}/webhooks/${stored.id}`;
      await client
        .put(path)
        .set('Authorization', `Bearer ${user.accessKey}`)
        .send({ ...webhook, name: 'Renamed' })
        .expect(200);
      expect((await Webhook.findById(stored._id))?.name).toBe('Renamed');

      await Team.updateOne(
        { _id: user.team },
        { $set: { settingsAdminIds: [] } },
      );
      await client
        .put(path)
        .set('Authorization', `Bearer ${user.accessKey}`)
        .send({ ...webhook, name: 'Forbidden change' })
        .expect(403);
      await client
        .delete(path)
        .set('Authorization', `Bearer ${user.accessKey}`)
        .expect(403);
      expect((await Webhook.findById(stored._id))?.name).toBe('Renamed');
      const catalog = await client
        .get(`${prefix}/webhooks`)
        .query({ service: 'generic' })
        .set('Authorization', `Bearer ${user.accessKey}`)
        .expect(200);
      expect(catalog.body.data).toEqual([
        expect.objectContaining({ name: 'Renamed' }),
      ]);

      await Team.updateOne(
        { _id: user.team },
        { $set: { settingsAdminIds: [user._id] } },
      );
      await client
        .delete(path)
        .set('Authorization', `Bearer ${user.accessKey}`)
        .expect(200);
      expect(await Webhook.findById(stored._id)).toBeNull();
    },
  );

  it.each(['', '/api/v2'])(
    'blocks membership and configuration writes through %s',
    async prefix => {
      const { agent, user } = await login();
      await Team.collection.updateOne(
        { _id: user.team },
        { $set: { settingsAdminIds: [] } },
      );
      const id = new mongoose.Types.ObjectId().toString();
      const endpoints: Array<
        readonly ['get' | 'post' | 'put' | 'delete', string]
      > = [
        ['get', '/team/members'],
        ['get', '/team/invitations'],
        ['post', '/team/invitation'],
        ['delete', `/team/invitation/${id}`],
        ['delete', `/team/member/${id}`],
        ...['connections', 'sources', 'webhooks'].flatMap(resource => [
          ['post', `/${resource}`] as const,
          ['put', `/${resource}/${id}`] as const,
          ['delete', `/${resource}/${id}`] as const,
        ]),
      ];
      for (const [method, path] of endpoints) {
        const response = await agent[method](prefix + path)
          .set('Authorization', `Bearer ${user.accessKey}`)
          .send({});
        expect({ method, path, status: response.status }).toEqual({
          method,
          path,
          status: 403,
        });
      }
      for (const path of ['/sources', '/connections', '/webhooks']) {
        await agent
          .get(prefix + path)
          .query(path === '/webhooks' ? { service: 'generic' } : {})
          .set('Authorization', `Bearer ${user.accessKey}`)
          .expect(200);
      }
      await agent.get('/dashboards').expect(200);
    },
  );

  it('blocks MCP source and webhook writes for non-administrators', async () => {
    const { user } = await login();
    await Team.collection.updateOne(
      { _id: user.team },
      { $set: { settingsAdminIds: [] } },
    );
    const client = await createTestClient({
      teamId: user.team.toString(),
      userId: user.id,
    });
    try {
      const id = new mongoose.Types.ObjectId().toString();
      const calls = [
        { name: 'clickstack_delete_source', args: { id } },
        { name: 'clickstack_delete_webhook', args: { id } },
        {
          name: 'clickstack_save_webhook',
          args: {
            name: 'Test',
            service: 'generic',
            url: 'https://example.com/hook',
          },
        },
        {
          name: 'clickstack_save_source',
          args: {
            name: 'Test',
            kind: 'log',
            connection: id,
            databaseName: 'default',
            tableName: 'logs',
            timestampValueExpression: 'Timestamp',
            defaultTableSelectExpression: 'Body',
          },
        },
      ];
      for (const { name, args } of calls) {
        const result = await callTool(client, name, args);
        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Forbidden');
      }
    } finally {
      await client.close();
    }
  });

  it('rechecks permissions on an existing MCP connection before changing stored resources', async () => {
    const { user } = await login();
    await Team.updateOne(
      { _id: user.team },
      { $set: { settingsAdminIds: [user._id] } },
    );
    const client = await createTestClient({
      teamId: user.team.toString(),
      userId: user.id,
    });
    try {
      const created = await callTool(client, 'clickstack_save_webhook', {
        name: 'MCP alerts',
        service: 'generic',
        url: 'https://example.com/hook',
      });
      expect(created.isError).toBeFalsy();
      const stored = await Webhook.findOne({ team: user.team }).orFail();
      expect(stored.name).toBe('MCP alerts');
      await Team.updateOne(
        { _id: user.team },
        { $set: { settingsAdminIds: [] } },
      );
      const denied = await callTool(client, 'clickstack_delete_webhook', {
        id: stored.id,
      });
      expect(denied.isError).toBe(true);
      expect(getFirstText(denied)).toContain('Forbidden');
      expect(await Webhook.findById(stored._id)).not.toBeNull();

      await Team.updateOne(
        { _id: user.team },
        { $set: { settingsAdminIds: [user._id] } },
      );
      const deleted = await callTool(client, 'clickstack_delete_webhook', {
        id: stored.id,
      });
      expect(deleted.isError).toBeFalsy();
      expect(await Webhook.findById(stored._id)).toBeNull();
    } finally {
      await client.close();
    }
  });
});
