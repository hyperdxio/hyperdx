import _ from 'lodash';

import {
  clearDBCollections,
  closeDB,
  getAgent,
  getServer,
} from '../../../fixtures';
import { getTeam } from '../../../controllers/team';
import { findUserByEmail } from '../../../controllers/user';

const MOCK_USER = {
  email: 'fake@deploysentinel.com',
  password: 'TacoCat!2#4X',
};

describe('team router', () => {
  const server = getServer();

  const login = async () => {
    const agent = getAgent(server);

    await agent
      .post('/register/password')
      .send({ ...MOCK_USER, confirmPassword: 'wrong-password' })
      .expect(400);
    await agent
      .post('/register/password')
      .send({ ...MOCK_USER, confirmPassword: MOCK_USER.password })
      .expect(200);

    const user = await findUserByEmail(MOCK_USER.email);
    const team = await getTeam(user?.team as any);

    if (team === null || user === null) {
      throw Error('team or user not found');
    }

    await user.save();

    // login app
    await agent.post('/login/password').send(MOCK_USER).expect(302);

    return {
      agent,
      team,
      user,
    };
  };

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('GET /team', async () => {
    const { agent } = await login();

    const resp = await agent.get('/team').expect(200);

    expect(_.omit(resp.body, ['_id', 'apiKey'])).toMatchInlineSnapshot(`
Object {
  "allowedAuthMethods": Array [],
  "name": "fake@deploysentinel.com's Team",
  "teamInvites": Array [],
  "users": Array [
    Object {
      "email": "fake@deploysentinel.com",
      "hasPasswordAuth": true,
      "isCurrentUser": true,
      "name": "fake@deploysentinel.com",
    },
  ],
}
`);
  });
});
