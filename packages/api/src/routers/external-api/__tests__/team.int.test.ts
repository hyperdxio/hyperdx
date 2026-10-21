import request, { SuperAgentTest } from 'supertest';

import { createOrgApiKey } from '@/controllers/orgApiKey';
import { getLoggedInAgent, getServer } from '@/fixtures';
import Alert from '@/models/alert';
import { ITeam } from '@/models/team';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';
import { IUser } from '@/models/user';

const TEAM_BASE_URL = '/api/v2/team';

describe('External API v2 Team', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let team: ITeam;
  let user: IUser;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const authRequest = (
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
  ) => agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);

  describe('GET /api/v2/team', () => {
    it('returns the team id and name', async () => {
      const response = await authRequest('get', TEAM_BASE_URL).expect(200);
      expect(response.body.data.id).toBe(team._id.toString());
      expect(response.body.data).toHaveProperty('name');
    });

    it('requires authentication', async () => {
      await request(server.getHttpServer()).get(TEAM_BASE_URL).expect(401);
    });
  });

  describe('GET /api/v2/team/members', () => {
    it('returns the current user', async () => {
      const response = await authRequest(
        'get',
        `${TEAM_BASE_URL}/members`,
      ).expect(200);
      const me = response.body.data.find(
        (m: { email: string }) => m.email === user.email,
      );
      expect(me).toBeTruthy();
      expect(me.isCurrentUser).toBe(true);
    });
  });

  describe('Invitations', () => {
    it('creates a pending invitation and lists then deletes it', async () => {
      const inviteRes = await authRequest('post', `${TEAM_BASE_URL}/invitation`)
        .send({ email: 'oss-invitee@deploysentinel.com' })
        .expect(200);
      expect(inviteRes.body.data.status).toBe('pending');
      expect(inviteRes.body.data.url).toContain('/join-team?token=');
      const invitationId = inviteRes.body.data.invitationId;

      const listRes = await authRequest(
        'get',
        `${TEAM_BASE_URL}/invitations`,
      ).expect(200);
      expect(
        listRes.body.data.some(
          (i: { email: string }) =>
            i.email === 'oss-invitee@deploysentinel.com',
        ),
      ).toBe(true);

      await authRequest(
        'delete',
        `${TEAM_BASE_URL}/invitation/${invitationId}`,
      ).expect(200);
    });

    it('rejects inviting an existing user', async () => {
      await authRequest('post', `${TEAM_BASE_URL}/invitation`)
        .send({ email: user.email })
        .expect(400);
    });

    it('handles concurrent invites for the same email idempotently', async () => {
      const email = 'race@deploysentinel.com';
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          authRequest('post', `${TEAM_BASE_URL}/invitation`).send({ email }),
        ),
      );

      // No request should 500 on the {teamId, email} unique-index race.
      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      // All requests resolve to the same single invitation.
      const ids = new Set(responses.map(r => r.body.data.invitationId));
      expect(ids.size).toBe(1);

      const listRes = await authRequest(
        'get',
        `${TEAM_BASE_URL}/invitations`,
      ).expect(200);
      expect(
        listRes.body.data.filter((i: { email: string }) => i.email === email)
          .length,
      ).toBe(1);
    });
  });

  describe('org API key scopes', () => {
    const keyFor = async (scope: 'admin' | 'member') =>
      (
        await createOrgApiKey(team._id, user._id, {
          description: scope,
          scope,
          expiry: 'never',
        })
      ).key;

    const withKey = (key: string, req: request.Test) =>
      req.set('Authorization', `Bearer ${key}`);

    const createMember = () =>
      User.create({ email: 'member@deploysentinel.com', team: team._id });

    it('blocks team administration for member-scoped keys', async () => {
      const key = await keyFor('member');
      const invite = await TeamInvite.create({
        teamId: team._id,
        email: 'pending@deploysentinel.com',
        token: 'token',
      });
      const member = await createMember();

      for (const req of [
        // Invite URLs let anyone join the team, so listing them is admin-only.
        agent.get(`${TEAM_BASE_URL}/invitations`),
        agent.post(`${TEAM_BASE_URL}/invitation`),
        agent.delete(`${TEAM_BASE_URL}/invitation/${invite._id}`),
        agent.delete(`${TEAM_BASE_URL}/member/${member._id}`),
      ]) {
        const res = await withKey(key, req)
          .send({ email: 'new@deploysentinel.com' })
          .expect(403);
        expect(res.body.message).toBe('This API key does not have admin scope');
      }
    });

    it('lets member-scoped keys list members, none of them current', async () => {
      const key = await keyFor('member');
      const res = await withKey(
        key,
        agent.get(`${TEAM_BASE_URL}/members`),
      ).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every(
          (m: { isCurrentUser: boolean }) => !m.isCurrentUser,
        ),
      ).toBe(true);
    });

    it('lets admin-scoped keys invite and remove members', async () => {
      const key = await keyFor('admin');
      await withKey(key, agent.post(`${TEAM_BASE_URL}/invitation`))
        .send({ email: 'new@deploysentinel.com' })
        .expect(200);

      const member = await createMember();
      const alert = await Alert.create({
        team: team._id,
        threshold: 1,
        interval: '5m',
        thresholdType: 'above',
        source: 'saved_search',
        channel: { type: 'webhook', webhookId: 'x' },
        createdBy: member._id,
      });

      await withKey(
        key,
        agent.delete(`${TEAM_BASE_URL}/member/${member._id}`),
      ).expect(200);
      expect(await User.findById(member._id)).toBeNull();
      const stored = await Alert.findById(alert._id).lean();
      const account = await User.findOne({ isServiceAccount: true });
      expect(stored?.createdBy).toEqual(account?._id);
    });

    it('stops an admin-scoped key removing the last member', async () => {
      const key = await keyFor('admin');
      const res = await withKey(
        key,
        agent.delete(`${TEAM_BASE_URL}/member/${user._id}`),
      ).expect(400);
      expect(res.body.message).toBe('Cannot remove the last team member');
      // The member is deleted then put back, and must keep their credentials.
      const restored = await User.findById(user._id).select('+hash +salt');
      expect(restored?.get('hash')).toBeTruthy();
      expect(restored?.accessKey).toBe(user.accessKey);
    });

    it('keeps a member when an admin key removes the last two at once', async () => {
      const key = await keyFor('admin');
      const member = await createMember();
      const results = await Promise.all(
        [user._id, member._id].map(id =>
          withKey(key, agent.delete(`${TEAM_BASE_URL}/member/${id}`)),
        ),
      );
      expect(results.map(r => r.status).sort()).not.toEqual([200, 200]);
      expect(
        await User.countDocuments({
          team: team._id,
          isServiceAccount: { $ne: true },
        }),
      ).toBeGreaterThan(0);
    });

    it('returns 404 for a non-member before applying the last-member rule', async () => {
      const key = await keyFor('admin');
      await withKey(
        key,
        agent.delete(`${TEAM_BASE_URL}/member/${new Alert()._id}`),
      ).expect(404);
    });

    it('hides service accounts from members and member removal', async () => {
      await keyFor('member');
      const account = await User.findOne({ isServiceAccount: true });

      const list = await authRequest('get', `${TEAM_BASE_URL}/members`).expect(
        200,
      );
      expect(list.body.data.map((m: { id: string }) => m.id)).not.toContain(
        account?._id.toString(),
      );

      const alert = await Alert.create({
        team: team._id,
        threshold: 1,
        interval: '5m',
        thresholdType: 'above',
        source: 'saved_search',
        channel: { type: 'webhook', webhookId: 'x' },
        createdBy: account?._id,
      });

      await authRequest(
        'delete',
        `${TEAM_BASE_URL}/member/${account?._id}`,
      ).expect(404);
      expect(await User.findById(account?._id)).not.toBeNull();
      expect((await Alert.findById(alert._id))?.createdBy).toEqual(
        account?._id,
      );
    });
  });
});
