import _ from 'lodash';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import OrgApiKey from '@/models/orgApiKey';
import Team from '@/models/team';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';

describe('team router', () => {
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

  it('GET /team', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/team').expect(200);

    expect(new Date(resp.body.createdAt).toString()).not.toBe('Invalid Date');

    expect(_.omit(resp.body, ['_id', 'id', 'apiKey', 'createdAt']))
      .toMatchInlineSnapshot(`
      {
        "allowedAuthMethods": [],
        "isMetricsSeriesTableEnabled": false,
        "name": "fake@deploysentinel.com's Team",
      }
    `);
  });

  it('GET /team reflects isMetricsSeriesTableEnabled when set', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Team.findByIdAndUpdate(team._id, {
      isMetricsSeriesTableEnabled: true,
    });

    const resp = await agent.get('/team').expect(200);

    expect(resp.body.isMetricsSeriesTableEnabled).toBe(true);
  });

  it('GET /team/tags - no tags', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/team/tags').expect(200);

    expect(resp.body.data).toMatchInlineSnapshot(`[]`);
  });

  it('GET /team/tags - unscoped, then scoped by resourceType', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    await agent
      .post('/dashboards')
      .send({
        name: 'Test',
        tiles: [],
        tags: ['test', 'test'], // make sure we dedupe
      })
      .expect(200);

    await agent.post('/sources').send({
      team: team.id,
      kind: 'log',
      name: 'My New Source',
      connection: new ObjectId().toString(),
      from: {
        databaseName: 'system',
        tableName: 'query_log',
      },
      timestampValueExpression: 'event_date',
      defaultTableSelectExpression: 'event_date,query',
      id: 'l-1148034466',
    });

    await agent
      .post('/saved-search')
      .send({
        id: '1',
        name: 'Test',
        select: 'SELECT * FROM table',
        where: 'WHERE x = 1',
        source: 'l-1148034466',
        tags: ['test', 'test2'],
      })
      .expect(200);

    await Alert.create({
      team: team.id,
      source: AlertSource.SAVED_SEARCH,
      savedSearch: new mongoose.Types.ObjectId(),
      threshold: 10,
      thresholdType: AlertThresholdType.ABOVE,
      interval: '5m',
      channel: {
        type: 'webhook',
        webhookId: new mongoose.Types.ObjectId().toString(),
      },
      tags: ['test2', 'test3'],
    });

    await Alert.create({
      team: new mongoose.Types.ObjectId(),
      source: AlertSource.SAVED_SEARCH,
      savedSearch: new mongoose.Types.ObjectId(),
      threshold: 10,
      thresholdType: AlertThresholdType.ABOVE,
      interval: '5m',
      channel: {
        type: 'webhook',
        webhookId: new mongoose.Types.ObjectId().toString(),
      },
      tags: ['other-team'],
    });

    const resp = await agent.get('/team/tags').expect(200);
    expect(resp.body.data.sort()).toStrictEqual(['test', 'test2', 'test3']);

    const dashboardTags = await agent
      .get('/team/tags')
      .query({ resourceType: 'dashboard' })
      .expect(200);
    expect(dashboardTags.body.data.sort()).toStrictEqual(['test']);

    const savedSearchTags = await agent
      .get('/team/tags')
      .query({ resourceType: 'savedSearch' })
      .expect(200);
    expect(savedSearchTags.body.data.sort()).toStrictEqual(['test', 'test2']);

    const alertTags = await agent
      .get('/team/tags')
      .query({ resourceType: 'alert' })
      .expect(200);
    expect(alertTags.body.data.sort()).toStrictEqual(['test2', 'test3']);
  });

  it('GET /team/tags - rejects an unknown resourceType', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent
      .get('/team/tags')
      .query({ resourceType: 'webhook' })
      .expect(400);
  });

  it('GET /team/members', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    await User.create({
      email: 'user1@example.com',
      team: team.id,
    });
    await User.create({
      email: 'user2@example.com',
      team: team.id,
    });
    const resp = await agent.get('/team/members').expect(200);

    expect(resp.body.data.map(({ _id, ...rest }: any) => rest))
      .toMatchInlineSnapshot(`
      [
        {
          "email": "fake@deploysentinel.com",
          "hasPasswordAuth": true,
          "isCurrentUser": true,
          "name": "fake@deploysentinel.com",
        },
        {
          "email": "user1@example.com",
          "hasPasswordAuth": true,
          "isCurrentUser": false,
        },
        {
          "email": "user2@example.com",
          "hasPasswordAuth": true,
          "isCurrentUser": false,
        },
      ]
    `);
  });

  it('POST /team/invitation', async () => {
    const { agent } = await getLoggedInAgent(server);
    const resp = await agent
      .post('/team/invitation')
      .send({
        email: 'user3@example.com',
        name: 'User 3',
      })
      .expect(200);
    const teamInvite = await TeamInvite.findOne({
      email: 'user3@example.com',
    });
    if (teamInvite == null) {
      throw new Error('TeamInvite not found');
    }
    expect(resp.body.url).toContain(`/join-team?token=${teamInvite.token}`);
  });

  it('POST /team/invitation with different case reuses existing invitation', async () => {
    const { agent } = await getLoggedInAgent(server);

    // Create invitation with lowercase email
    await agent
      .post('/team/invitation')
      .send({
        email: 'casesensitive@example.com',
        name: 'Case Test',
      })
      .expect(200);

    const firstInvite = await TeamInvite.findOne({
      email: 'casesensitive@example.com',
    });
    expect(firstInvite).not.toBeNull();
    const firstToken = firstInvite!.token;

    // Try to create invitation with uppercase email
    await agent
      .post('/team/invitation')
      .send({
        email: 'CaseSensitive@Example.com',
        name: 'Case Test 2',
      })
      .expect(200);

    // Should reuse the same invitation (same token)
    const secondInvite = await TeamInvite.findOne({
      email: 'casesensitive@example.com',
    });
    expect(secondInvite).not.toBeNull();
    expect(secondInvite!.token).toBe(firstToken);

    // Should only have one invitation in the database
    const allInvites = await TeamInvite.find({
      email: 'casesensitive@example.com',
    });
    expect(allInvites).toHaveLength(1);
  });

  it('POST /team/invitation rejects existing user regardless of email case', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create a user with lowercase email
    await User.create({
      email: 'existinguser@example.com',
      team: team.id,
    });

    // Try to invite with different casing - should be rejected
    await agent
      .post('/team/invitation')
      .send({
        email: 'ExistingUser@Example.com',
        name: 'Existing User',
      })
      .expect(400);

    // Try to invite with exact same casing - should also be rejected
    await agent
      .post('/team/invitation')
      .send({
        email: 'existinguser@example.com',
        name: 'Existing User',
      })
      .expect(400);
  });

  it('GET /team/invitations', async () => {
    const { agent } = await getLoggedInAgent(server);
    await Promise.all([
      agent
        .post('/team/invitation')
        .send({
          email: 'user1@example.com',
          name: 'User 1',
        })
        .expect(200),
      agent
        .post('/team/invitation')
        .send({
          email: 'user2@example.com',
          name: 'User 2',
        })
        .expect(200),
    ]);

    const resp = await agent.get('/team/invitations').expect(200);
    expect(
      resp.body.data.map(i => ({
        email: i.email,
        name: i.name,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "email": "user1@example.com",
          "name": "User 1",
        },
        {
          "email": "user2@example.com",
          "name": "User 2",
        },
      ]
    `);
  });

  it('DELETE /team/member/:userId removes a user', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const user1 = await User.create({
      email: 'user1@example.com',
      team: team.id,
    });

    await agent.delete(`/team/member/${user1._id}`).expect(200);

    const resp2 = await agent.get('/team/members').expect(200);

    expect(resp2.body.data).toHaveLength(1);
  });

  it('DELETE /team/member/:userId updates alerts created by the removed user', async () => {
    const { agent, team, user } = await getLoggedInAgent(server);

    const user1 = await User.create({
      email: 'user1@example.com',
      team: team.id,
    });

    const alert = await Alert.create({
      createdBy: user1._id,
      team: team.id,
      source: AlertSource.SAVED_SEARCH,
      savedSearch: new mongoose.Types.ObjectId(),
      threshold: 10,
      thresholdType: AlertThresholdType.ABOVE,
      interval: '5m',
      channel: {
        type: 'webhook',
        webhookId: new mongoose.Types.ObjectId().toString(),
      },
    });

    const alertInAnotherTeam = await Alert.create({
      createdBy: user1._id,
      team: new mongoose.Types.ObjectId(), // Different team ID
      source: AlertSource.SAVED_SEARCH,
      savedSearch: new mongoose.Types.ObjectId(),
      threshold: 10,
      thresholdType: AlertThresholdType.ABOVE,
      interval: '5m',
      channel: {
        type: 'webhook',
        webhookId: new mongoose.Types.ObjectId().toString(),
      },
    });

    await agent.delete(`/team/member/${user1._id}`).expect(200);

    const alertAfterUserDeletion = await Alert.findById(alert._id);
    expect(alertAfterUserDeletion).not.toBeNull();
    expect(alertAfterUserDeletion?.createdBy?.toString()).toEqual(
      user.id.toString(),
    );

    // Ensure alert in another team is not modified
    const alertInAnotherTeamAfterDeletion = await Alert.findById(
      alertInAnotherTeam._id,
    );
    expect(alertInAnotherTeamAfterDeletion).not.toBeNull();
    expect(alertInAnotherTeamAfterDeletion?.createdBy?.toString()).toEqual(
      user1._id.toString(),
    );
  });

  it('DELETE /team/invitation/:teamInviteId', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const invite = await TeamInvite.create({
      email: 'fake_invite@example.com',
      name: 'Fake Invite',
      teamId: team.id,
      token: 'fake_token',
    });

    await agent.delete(`/team/invitation/${invite._id}`).expect(200);

    const resp2 = await agent.get('/team/invitations').expect(200);

    expect(resp2.body.data).toHaveLength(0);
  });

  // The delete used to be an unscoped findByIdAndDelete, so any authenticated
  // user could revoke another team's pending invitation given its id.
  it('DELETE /team/invitation/:teamInviteId will not touch another team', async () => {
    const { agent } = await getLoggedInAgent(server);

    const otherTeamInvite = await TeamInvite.create({
      email: 'other_team@example.com',
      name: 'Other Team Invite',
      teamId: new ObjectId(),
      token: 'other_team_token',
    });

    await agent.delete(`/team/invitation/${otherTeamInvite._id}`).expect(404);

    expect(await TeamInvite.findById(otherTeamInvite._id)).not.toBeNull();
  });

  it('PATCH /team/apiKey', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.patch('/team/apiKey').expect(200);

    expect(resp.body.newApiKey.length).toBeGreaterThan(0);
  });

  describe('org API keys', () => {
    const body = {
      description: 'terraform',
      expiry: '30d',
    } as const;

    it('returns the key on create only', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      const created = await agent.post('/team/api-keys').send(body).expect(200);
      expect(created.body.key).toMatch(/^hdx_org_/);

      const list = await agent.get('/team/api-keys').expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).not.toHaveProperty('key');
      expect(list.body.data[0]).toMatchObject({
        id: created.body.id,
        description: 'terraform',
        lastUsedAt: null,
        createdBy: { email: user.email },
      });
    });

    it.each([
      { ...body, description: '' },
      { ...body, description: 'x'.repeat(101) },
      { ...body, expiry: '7d' },
    ])('rejects invalid bodies %#', async invalid => {
      const { agent } = await getLoggedInAgent(server);
      await agent.post('/team/api-keys').send(invalid).expect(400);
    });

    it('edits only the description', async () => {
      const { agent } = await getLoggedInAgent(server);
      const { body: created } = await agent
        .post('/team/api-keys')
        .send(body)
        .expect(200);
      const updated = await agent
        .patch(`/team/api-keys/${created.id}`)
        .send({ description: 'ci' })
        .expect(200);
      expect(updated.body).toMatchObject({
        description: 'ci',
      });
    });

    it('revokes immediately', async () => {
      const { agent } = await getLoggedInAgent(server);
      const { body: created } = await agent
        .post('/team/api-keys')
        .send(body)
        .expect(200);
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${created.key}`)
        .expect(200);
      await agent.delete(`/team/api-keys/${created.id}`).expect(204);
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${created.key}`)
        .expect(401);
    });

    it('hides other teams keys', async () => {
      const { agent } = await getLoggedInAgent(server);
      // OSS allows a single team, so plant a key under a different team id.
      const other = await OrgApiKey.create({
        team: new mongoose.Types.ObjectId(),
        keyHash: 'other',
        description: 'other team',
        createdBy: new mongoose.Types.ObjectId(),
        serviceAccount: new mongoose.Types.ObjectId(),
      });
      const list = await agent.get('/team/api-keys').expect(200);
      expect(list.body.data).toHaveLength(0);
      await agent
        .patch(`/team/api-keys/${other._id}`)
        .send({ description: 'mine now' })
        .expect(404);
      await agent.delete(`/team/api-keys/${other._id}`).expect(404);
      expect(await OrgApiKey.findById(other._id)).not.toBeNull();
    });

    it('keeps working after the creator is deleted', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      const { body: created } = await agent
        .post('/team/api-keys')
        .send(body)
        .expect(200);
      await User.deleteOne({ _id: user._id });

      const key = await OrgApiKey.findById(created.id).populate('createdBy');
      expect(key?.createdBy).toBeNull();
      await getAgent(server)
        .get('/api/v2')
        .set('Authorization', `Bearer ${created.key}`)
        .expect(200);
    });

    it('rejects bearer auth on the management routes', async () => {
      const { agent } = await getLoggedInAgent(server);
      const { body: created } = await agent
        .post('/team/api-keys')
        .send(body)
        .expect(200);
      await getAgent(server)
        .get('/team/api-keys')
        .set('Authorization', `Bearer ${created.key}`)
        .expect(401);
    });

    it('never lets a service account sign in', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      const { body: created } = await agent
        .post('/team/api-keys')
        .send(body)
        .expect(200);
      const key = await OrgApiKey.findById(created.id);
      // Give the service account the signed-in user's password hash, so a
      // correct password is presented and only the service-account check stops it.
      const human = await User.findById(user._id).select('+hash +salt');
      const account = await User.findByIdAndUpdate(
        key?.serviceAccount,
        { hash: human?.get('hash'), salt: human?.get('salt') },
        { new: true },
      );

      const res = await getAgent(server)
        .post('/login/password')
        .send({ email: account?.email, password: 'TacoCat!2#4X' });
      expect(res.status).toBe(303);
      expect(res.headers.location).toContain('/login?err=');
    });
  });
});
