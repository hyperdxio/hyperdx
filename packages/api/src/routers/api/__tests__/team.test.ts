import _ from 'lodash';

import { getLoggedInAgent, getServer } from '@/fixtures';
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

    expect(_.omit(resp.body, ['_id', 'apiKey'])).toMatchInlineSnapshot(`
Object {
  "allowedAuthMethods": Array [],
  "name": "fake@deploysentinel.com's Team",
  "sentryDSN": "",
  "teamInvites": Array [],
  "users": Array [
    Object {
      "_id": "${resp.body.users[0]._id}",
      "email": "fake@deploysentinel.com",
      "hasPasswordAuth": true,
      "isCurrentUser": true,
      "name": "fake@deploysentinel.com",
    },
  ],
}
`);
  });

  it('GET /team/tags - no tags', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/team/tags').expect(200);

    expect(resp.body.data).toMatchInlineSnapshot(`Array []`);
  });

  it('GET /team/tags', async () => {
    const { agent } = await getLoggedInAgent(server);
    await agent
      .post('/dashboards')
      .send({
        name: 'Test',
        charts: [],
        query: '',
        tags: ['test', 'test'], // make sure we dedupe
      })
      .expect(200);
    await agent
      .post('/log-views')
      .send({
        name: 'Test',
        query: '',
        tags: ['test2'],
      })
      .expect(200);
    const resp = await agent.get('/team/tags').expect(200);
    expect(resp.body.data).toStrictEqual(['test', 'test2']);
  });

  it('GET /team/members', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const user1 = await User.create({
      email: 'user1@example.com',
      team: team._id,
    });
    const user2 = await User.create({
      email: 'user2@example.com',
      team: team._id,
    });
    const resp = await agent.get('/team/members').expect(200);

    expect(resp.body.data).toMatchInlineSnapshot(`
Array [
  Object {
    "email": "fake@deploysentinel.com",
    "hasPasswordAuth": true,
    "name": "fake@deploysentinel.com",
  },
  Object {
    "email": "user1@example.com",
    "hasPasswordAuth": true,
  },
  Object {
    "email": "user2@example.com",
    "hasPasswordAuth": true,
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
    expect(resp.body.url).toBe(
      `http://localhost:9090/join-team?token=${teamInvite.token}`,
    );
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
Array [
  Object {
    "email": "user1@example.com",
    "name": "User 1",
  },
  Object {
    "email": "user2@example.com",
    "name": "User 2",
  },
]
`);
  });

  it('DELETE /team/user/:userId', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const user1 = await User.create({
      email: 'user1@example.com',
      team: team._id,
    });

    await agent.delete(`/team/user/${user1._id}`).expect(200);

    const resp2 = await agent.get('/team').expect(200);

    expect(resp2.body.users).toHaveLength(0);
  });

  it('DELETE /invitations/:teamInviteId', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const invite = await TeamInvite.create({
      email: 'fake_invite@example.com',
      name: 'Fake Invite',
      teamId: team._id,
      token: 'fake_token',
    });

    await agent.delete(`/team/invitations/${invite._id}`).expect(200);

    const resp2 = await agent.get('/team/invitations').expect(200);

    expect(resp2.body.data).toHaveLength(0);
  });
});
