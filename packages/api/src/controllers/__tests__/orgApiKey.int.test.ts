import mongoose from 'mongoose';

import {
  createOrgApiKey,
  listOrgApiKeys,
  revokeOrgApiKey,
  touchOrgApiKeyLastUsed,
  updateOrgApiKeyDescription,
} from '@/controllers/orgApiKey';
import { createTeam } from '@/controllers/team';
import {
  createVirtualUser,
  deleteTeamMemberKeepingOne,
  findUserByAccessKey,
  findUsersByTeam,
  hashOrgApiKey,
} from '@/controllers/user';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import User from '@/models/user';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('orgApiKey controller', () => {
  const creator = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  const create = async (
    teamId: mongoose.Types.ObjectId,
    expiry: '30d' | '1y' | 'never' = '30d',
  ) =>
    createOrgApiKey(teamId, creator, {
      description: 'terraform',
      expiry,
    });

  it('returns a prefixed key once and stores only its hash', async () => {
    const team = await createTeam({ name: 'A' });
    const { doc, key } = await create(team._id);

    expect(key).toMatch(/^hdx_org_[A-Za-z0-9_-]{43}$/);
    const stored = await User.findById(doc._id).lean();
    expect(stored?.accessKey).toBe(hashOrgApiKey(key));
    expect(Object.values(stored ?? {})).not.toContain(key);
  });

  it.each([
    ['30d', 30 * DAY_MS],
    ['1y', 365 * DAY_MS],
  ] as const)('sets expiresAt for %s', async (expiry, offset) => {
    const team = await createTeam({ name: 'A' });
    const before = Date.now();
    const { doc } = await create(team._id, expiry);
    const expiresAt = doc.expiresAt?.getTime() ?? 0;
    expect(Math.abs(expiresAt - (before + offset))).toBeLessThan(1000);
  });

  it('stores null expiresAt for never', async () => {
    const team = await createTeam({ name: 'A' });
    const { doc } = await create(team._id, 'never');
    expect(doc.expiresAt).toBeNull();
  });

  it('finds active keys and rejects expired, unknown, and non-org keys', async () => {
    const team = await createTeam({ name: 'A' });
    const { doc, key } = await create(team._id);

    expect((await findUserByAccessKey(key))?._id).toEqual(doc._id);
    expect(
      await findUserByAccessKey(key, doc.expiresAt ?? new Date(0)),
    ).toBeNull();
    expect(await findUserByAccessKey(`hdx_org_${'x'.repeat(43)}`)).toBeNull();
    expect(
      await findUserByAccessKey('4b9e3c1a-7f2d-4e8b-9a6c-1d2e3f4a5b6c'),
    ).toBeNull();
    // The stored hash is not a credential.
    expect(await findUserByAccessKey(hashOrgApiKey(key))).toBeNull();
  });

  it('scopes list and delete to the team', async () => {
    const teamA = await createTeam({ name: 'A' });
    // OSS allows a single team, so team B only needs to be a distinct id.
    const teamB = new mongoose.Types.ObjectId();
    const { doc } = await create(teamA._id);

    expect(await listOrgApiKeys(teamB)).toHaveLength(0);
    expect(await revokeOrgApiKey(teamB, doc._id.toString())).toBeNull();
    expect(await listOrgApiKeys(teamA._id)).toHaveLength(1);
  });

  it('leaves virtual users that are not org keys alone', async () => {
    const team = await createTeam({ name: 'A' });
    const other = await createVirtualUser({
      teamId: team._id,
      name: 'actor',
      email: 'actor@example.com',
    });

    expect(await listOrgApiKeys(team._id)).toHaveLength(0);
    expect(await revokeOrgApiKey(team._id, other._id.toString())).toBeNull();
  });

  it('writes lastUsedAt at most once per 5 minutes', async () => {
    const team = await createTeam({ name: 'A' });
    const { doc } = await create(team._id);
    const t0 = new Date();

    const lastUsed = async () => {
      // Writes are fire-and-forget; give them a moment to land.
      await new Promise(r => setTimeout(r, 100));
      return (await User.findById(doc._id))?.lastUsedAt?.getTime();
    };

    touchOrgApiKeyLastUsed(doc, t0);
    expect(await lastUsed()).toBe(t0.getTime());

    const fresh = (await User.findById(doc._id))!;
    touchOrgApiKeyLastUsed(fresh, new Date(t0.getTime() + 60_000));
    expect(await lastUsed()).toBe(t0.getTime());

    const t6 = new Date(t0.getTime() + 6 * 60_000);
    touchOrgApiKeyLastUsed(fresh, t6);
    expect(await lastUsed()).toBe(t6.getTime());
  });

  describe('service accounts', () => {
    it('creates a service account user for each key', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc } = await create(team._id);
      const account = await User.findById(doc._id);

      expect(account).toMatchObject({
        isVirtual: true,
        name: 'terraform',
      });
      expect(account?.team).toEqual(team._id);
      expect(account?.email).toMatch(
        /^sa-[0-9a-f]{24}@service-accounts\.hyperdx\.invalid$/,
      );
    });

    it('keeps service accounts out of members', async () => {
      const team = await createTeam({ name: 'A' });
      await create(team._id);
      expect(await findUsersByTeam(team._id)).toHaveLength(0);
    });

    it('renames the service account with the key', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc } = await create(team._id);
      await updateOrgApiKeyDescription(team._id, doc._id.toString(), 'ci');
      expect((await User.findById(doc._id))?.name).toBe('ci');
    });

    it('keeps the service account when the key is revoked', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc, key } = await create(team._id);
      await revokeOrgApiKey(team._id, doc._id.toString());
      expect(await findUserByAccessKey(key)).toBeNull();
      expect(await listOrgApiKeys(team._id)).toHaveLength(0);
      expect(await User.findById(doc._id)).not.toBeNull();
    });
  });

  describe('member removal by a service account', () => {
    const setupTeam = async (people: number) => {
      const team = await createTeam({ name: 'A' });
      const { doc } = await create(team._id);
      const users = await Promise.all(
        Array.from({ length: people }, (_, i) =>
          User.create({ email: `p${i}@example.com`, team: team._id }),
        ),
      );
      return { team, serviceAccount: doc._id, users };
    };

    afterEach(() => jest.restoreAllMocks());

    it('refuses the last person without deleting them', async () => {
      const { team, serviceAccount, users } = await setupTeam(1);
      const deleteSpy = jest.spyOn(User, 'findOneAndDelete');

      const result = await deleteTeamMemberKeepingOne(
        team._id,
        users[0]._id.toString(),
        serviceAccount,
      );
      expect(result).toBe('last_member');
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('retries putting a member back when the first insert fails', async () => {
      const { team, serviceAccount, users } = await setupTeam(2);
      // Simulate a concurrent removal: two people before the delete, none after.
      // Widened to SpyInstance: the Mongoose overloads type these mocks as never.
      const count: jest.SpyInstance = jest.spyOn(User, 'countDocuments');
      count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      const insert: jest.SpyInstance = jest.spyOn(User.collection, 'insertOne');
      insert.mockRejectedValueOnce(new Error('transient'));

      const result = await deleteTeamMemberKeepingOne(
        team._id,
        users[0]._id.toString(),
        serviceAccount,
      );
      expect(result).toBe('last_member');
      expect(await User.findById(users[0]._id)).not.toBeNull();
    });

    it('treats a duplicate _id on restore as already restored', async () => {
      const { team, serviceAccount, users } = await setupTeam(2);
      const count: jest.SpyInstance = jest.spyOn(User, 'countDocuments');
      count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      const insert: jest.SpyInstance = jest.spyOn(User.collection, 'insertOne');
      insert.mockRejectedValueOnce(
        Object.assign(new Error('E11000'), {
          code: 11000,
          keyPattern: { _id: 1 },
        }),
      );

      const result = await deleteTeamMemberKeepingOne(
        team._id,
        users[0]._id.toString(),
        serviceAccount,
      );
      expect(result).toBe('last_member');
      expect(insert).toHaveBeenCalledTimes(1);
    });
  });
});
