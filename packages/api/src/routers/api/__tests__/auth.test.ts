import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';

const MOCK_USER = {
  email: 'authtest@example.com',
  password: 'TacoCat!2#4X',
};

describe('auth router', () => {
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

  describe('POST /register/password', () => {
    it('registers first user and creates team', async () => {
      const agent = getAgent(server);

      const response = await agent
        .post('/register/password')
        .send({ ...MOCK_USER, confirmPassword: MOCK_USER.password })
        .expect(200);

      expect(response.body.status).toBe('success');

      // Verify user was created
      const user = await User.findOne({ email: MOCK_USER.email });
      expect(user).not.toBeNull();
      expect(user!.team).toBeDefined();
    });

    it('returns 409 if team already exists', async () => {
      // First, register to create a team
      await getLoggedInAgent(server);

      // Try to register again
      const agent = getAgent(server);
      await agent
        .post('/register/password')
        .send({
          email: 'another@example.com',
          password: 'AnotherPass!2#4X',
          confirmPassword: 'AnotherPass!2#4X',
        })
        .expect(409);
    });

    it('returns 400 for invalid email/password', async () => {
      const agent = getAgent(server);

      // Invalid email
      await agent
        .post('/register/password')
        .send({
          email: 'not-an-email',
          password: 'TacoCat!2#4X',
          confirmPassword: 'TacoCat!2#4X',
        })
        .expect(400);

      // Password too short
      await agent
        .post('/register/password')
        .send({
          email: 'valid@example.com',
          password: 'short',
          confirmPassword: 'short',
        })
        .expect(400);
    });

    it('lowercases email via passport pre-save hook', async () => {
      const agent = getAgent(server);

      const response = await agent
        .post('/register/password')
        .send({
          email: 'UpperCase@Example.COM',
          password: 'TacoCat!2#4X',
          confirmPassword: 'TacoCat!2#4X',
        })
        .expect(200);

      expect(response.body.status).toBe('success');

      // Verify email was lowercased
      const user = await User.findOne({ email: 'uppercase@example.com' });
      expect(user).not.toBeNull();
    });
  });

  describe('POST /team/setup/:token', () => {
    it('joins team with valid invite', async () => {
      const { team } = await getLoggedInAgent(server);

      // Create a team invite
      const invite = await TeamInvite.create({
        email: 'newuser@example.com',
        teamId: team._id,
        token: 'valid-token-123',
      });

      const agent = getAgent(server);
      const response = await agent
        .post('/team/setup/valid-token-123')
        .send({ password: 'NewUser!Pass2#4X' })
        .expect(302);

      // Should redirect to dashboard
      expect(response.header.location).toContain('/');

      // Verify user was created on the team
      const user = await User.findOne({ email: 'newuser@example.com' });
      expect(user).not.toBeNull();
      expect(user!.team.toString()).toBe(team._id.toString());
    });

    it('deletes invite after successful join', async () => {
      const { team } = await getLoggedInAgent(server);

      await TeamInvite.create({
        email: 'joinuser@example.com',
        teamId: team._id,
        token: 'delete-after-join',
      });

      const agent = getAgent(server);
      await agent
        .post('/team/setup/delete-after-join')
        .send({ password: 'NewUser!Pass2#4X' })
        .expect(302);

      // Verify invite was deleted
      const invite = await TeamInvite.findOne({ token: 'delete-after-join' });
      expect(invite).toBeNull();
    });

    it('returns error for invalid/expired token', async () => {
      const agent = getAgent(server);
      // Need a logged in agent to create a team first
      await getLoggedInAgent(server);

      const freshAgent = getAgent(server);
      const response = await freshAgent
        .post('/team/setup/nonexistent-token')
        .send({ password: 'NewUser!Pass2#4X' })
        .expect(401);
    });

    it('returns error for invalid password', async () => {
      const { team } = await getLoggedInAgent(server);

      await TeamInvite.create({
        email: 'badpw@example.com',
        teamId: team._id,
        token: 'badpw-token',
      });

      const agent = getAgent(server);
      const response = await agent
        .post('/team/setup/badpw-token')
        .send({ password: 'short' })
        .expect(302);

      // Should redirect with error
      expect(response.header.location).toContain('err=invalid');
    });
  });
});
