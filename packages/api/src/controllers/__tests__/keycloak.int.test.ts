import type { IDToken } from 'openid-client';

import { resolveKeycloakUser } from '@/controllers/keycloak';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';

const claims: IDToken = {
  iss: 'https://id.example.com/realms/hdx',
  sub: 'stable-subject',
  aud: 'hyperdx',
  iat: 1,
  exp: 9999999999,
  email: 'member@example.com',
  email_verified: true,
};
const identity = { issuer: claims.iss, subject: claims.sub };

describe('Keycloak identity and invitation authorization', () => {
  beforeAll(async () => {
    await connectDB();
    await User.init();
    await TeamInvite.init();
  });
  afterEach(clearDBCollections);
  afterAll(closeDB);

  async function invite(email = 'member@example.com') {
    const team = await Team.create({ name: 'Inviting team' });
    const invitation = await TeamInvite.create({
      teamId: team._id,
      email,
      token: 'invitation-token',
    });
    return { team, invitation };
  }

  it('rejects an unknown subject without provisioning a team or user', async () => {
    expect(await resolveKeycloakUser(claims)).toBeNull();
    expect(await User.countDocuments()).toBe(0);
    expect(await Team.countDocuments()).toBe(0);
  });

  it('logs in an explicitly mapped user even after their Keycloak email changes', async () => {
    const { team } = await invite();
    const user = await User.create({
      email: 'old@example.com',
      team: team._id,
      keycloak: identity,
    });
    expect((await resolveKeycloakUser(claims))?._id).toEqual(user._id);
    expect(await User.countDocuments()).toBe(1);
  });

  it('does not link an existing account by email, even with an invitation', async () => {
    const { team, invitation } = await invite();
    const existing = await User.create({ email: claims.email, team: team._id });
    expect(await resolveKeycloakUser(claims, invitation.token)).toBeNull();
    expect((await User.findById(existing._id))?.keycloak).toBeUndefined();
    expect(await TeamInvite.findById(invitation._id)).not.toBeNull();
  });

  it('provisions only the team named in a valid invitation', async () => {
    const { team, invitation } = await invite();
    const user = await resolveKeycloakUser(claims, invitation.token);
    expect(user?.team).toEqual(team._id);
    expect(user?.keycloak).toMatchObject(identity);
    expect(await TeamInvite.findById(invitation._id)).toBeNull();
    expect(await Team.countDocuments()).toBe(1);
  });

  it.each([
    { email_verified: false },
    { email_verified: undefined },
    { email: 'someone-else@example.com' },
    { email: undefined },
  ])(
    'rejects unverified or mismatched invitation claims (%j)',
    async changes => {
      const { invitation } = await invite();
      expect(
        await resolveKeycloakUser({ ...claims, ...changes }, invitation.token),
      ).toBeNull();
      expect(await User.countDocuments()).toBe(0);
    },
  );

  it('rejects expired invitations without relying on the Mongo TTL sweep', async () => {
    const { invitation } = await invite();
    await TeamInvite.collection.updateOne(
      { _id: invitation._id },
      { $set: { createdAt: new Date(Date.now() - 31 * 86400000) } },
    );
    expect(await resolveKeycloakUser(claims, invitation.token)).toBeNull();
  });

  it('rejects identities and invitations whose team was deleted', async () => {
    const { team, invitation } = await invite();
    await Team.deleteOne({ _id: team._id });
    expect(await resolveKeycloakUser(claims, invitation.token)).toBeNull();
    await User.create({
      email: claims.email,
      team: team._id,
      keycloak: identity,
    });
    expect(await resolveKeycloakUser(claims)).toBeNull();
  });

  it('does not move a mapped user to another invited team', async () => {
    const originalTeam = await Team.create({ name: 'Original team' });
    const user = await User.create({
      email: claims.email,
      team: originalTeam._id,
      keycloak: identity,
    });
    const { invitation } = await invite();
    expect((await resolveKeycloakUser(claims, invitation.token))?.team).toEqual(
      originalTeam._id,
    );
    expect((await User.findById(user._id))?.team).toEqual(originalTeam._id);
  });

  it('enforces uniqueness on issuer and subject while allowing users without an identity', async () => {
    await User.create([
      { email: 'local1@example.com' },
      { email: 'local2@example.com' },
    ]);
    await User.create({ email: 'first@example.com', keycloak: identity });
    await expect(
      User.create({ email: 'second@example.com', keycloak: identity }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      User.create({
        email: 'third@example.com',
        keycloak: { ...identity, issuer: 'https://other.example.com' },
      }),
    ).resolves.toBeDefined();
  });

  it('never creates duplicate accounts during concurrent first logins', async () => {
    const { invitation } = await invite();
    const users = await Promise.all([
      resolveKeycloakUser(claims, invitation.token),
      resolveKeycloakUser(claims, invitation.token),
    ]);
    expect(users.some(Boolean)).toBe(true);
    expect(await User.countDocuments()).toBe(1);
    const created = await User.findOne({ 'keycloak.subject': claims.sub });
    for (const user of users.filter(u => u != null))
      expect(user._id).toEqual(created?._id);
  });
});
