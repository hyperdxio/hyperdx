import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';

const MEMBER_EMAIL = 'removed-member@example.com';
// Repeats the password from `MOCK_USER` in fixtures.ts, which is not exported.
// It has to satisfy the same complexity rules the setup route enforces.
const MEMBER_PASSWORD = 'TacoCat!2#4X';

describe('passport session deserialization', () => {
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

  const findInvite = async () => {
    const invite = await TeamInvite.findOne({ email: MEMBER_EMAIL });
    if (invite == null) {
      throw new Error('TeamInvite not found');
    }
    return invite;
  };

  // Registers the admin, invites MEMBER_EMAIL and accepts the invite on a
  // second agent, so `memberAgent` ends up holding that member's session
  // cookie the way a real browser would.
  const setUpTeamWithMember = async () => {
    const { agent: adminAgent } = await getLoggedInAgent(server);

    await adminAgent
      .post('/team/invitation')
      .send({ email: MEMBER_EMAIL, name: 'Removed Member' })
      .expect(200);

    const memberAgent = getAgent(server);
    await memberAgent
      .post(`/team/setup/${(await findInvite()).token}`)
      .send({ password: MEMBER_PASSWORD })
      .expect(303);

    const member = await User.findOne({ email: MEMBER_EMAIL });
    if (member == null) {
      throw new Error('member not found');
    }

    return { adminAgent, memberAgent, member };
  };

  it('answers 401 once the session user has been deleted', async () => {
    const { adminAgent, memberAgent, member } = await setUpTeamWithMember();

    await memberAgent.get('/team').expect(200);

    await adminAgent.delete(`/team/member/${member._id}`).expect(200);

    // The member's browser still holds its connect.sid cookie. Before this
    // fix, deserializeUser answered `done(new Error('User not found'))`, so
    // every request carrying that cookie came back 500
    // {"message":"Something went wrong :("}.
    await memberAgent.get('/team').expect(401);
  });

  it('lets a deleted user accept a fresh invite with their stale cookie', async () => {
    const { adminAgent, memberAgent, member } = await setUpTeamWithMember();

    await adminAgent.delete(`/team/member/${member._id}`).expect(200);

    // Re-invite the same person. Their browser still has the cookie from the
    // deleted account, and the invite is accepted on a public route that never
    // required authentication in the first place.
    await adminAgent
      .post('/team/invitation')
      .send({ email: MEMBER_EMAIL, name: 'Removed Member' })
      .expect(200);

    const invite = await findInvite();
    await memberAgent
      .post(`/team/setup/${invite.token}`)
      .send({ password: MEMBER_PASSWORD })
      .expect(303);

    expect(await User.findOne({ email: MEMBER_EMAIL })).not.toBeNull();
    expect(await TeamInvite.findById(invite._id)).toBeNull();
  });
});
