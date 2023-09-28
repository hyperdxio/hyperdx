import _ from 'lodash';

import {
  clearDBCollections,
  closeDB,
  getAgent,
  getServer,
} from '../../../fixtures';
import { getTeam } from '../../../controllers/team';
import { findUserByEmail } from '../../../controllers/user';

describe('team router', () => {
  const server = getServer();

  const login = async () => {
    const agent = getAgent(server);

    await agent
      .post('/register/password')
      .send({
        email: 'fake@deploysentinel.com',
        password: 'tacocat1234',
      })
      .expect(302);

    const user = await findUserByEmail('fake@deploysentinel.com');
    const team = await getTeam(user?.team as any);

    if (team === null || user === null) {
      throw Error('team or user not found');
    }

    await user.save();

    // login app
    await agent
      .post('/login/password')
      .send({
        email: 'fake@deploysentinel.com',
        password: 'tacocat1234',
      })
      .expect(302);

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
