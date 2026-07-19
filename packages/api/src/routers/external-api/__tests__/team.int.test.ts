import request, { SuperAgentTest } from 'supertest';

import { getLoggedInAgent, getServer } from '@/fixtures';
import { ITeam } from '@/models/team';
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
});
