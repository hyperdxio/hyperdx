import mongoose from 'mongoose';

import {
  createOrgApiKey,
  deleteOrgApiKey,
  findActiveOrgApiKey,
  hashOrgApiKey,
  listOrgApiKeys,
  touchOrgApiKeyLastUsed,
  updateOrgApiKeyDescription,
} from '@/controllers/orgApiKey';
import { createTeam } from '@/controllers/team';
import { findUserByAccessKey, findUsersByTeam } from '@/controllers/user';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import OrgApiKey from '@/models/orgApiKey';
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
      scope: 'member',
      expiry,
    });

  it('returns a prefixed key once and stores only its hash', async () => {
    const team = await createTeam({ name: 'A' });
    const { doc, key } = await create(team._id);

    expect(key).toMatch(/^hdx_org_[A-Za-z0-9_-]{43}$/);
    const stored = await OrgApiKey.findById(doc._id).lean();
    expect(stored?.keyHash).toBe(hashOrgApiKey(key));
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

    expect((await findActiveOrgApiKey(key))?.orgApiKey._id).toEqual(doc._id);
    expect(
      await findActiveOrgApiKey(key, doc.expiresAt ?? new Date(0)),
    ).toBeNull();
    expect(await findActiveOrgApiKey(`hdx_org_${'x'.repeat(43)}`)).toBeNull();
    expect(
      await findActiveOrgApiKey('4b9e3c1a-7f2d-4e8b-9a6c-1d2e3f4a5b6c'),
    ).toBeNull();
  });

  it('scopes list and delete to the team', async () => {
    const teamA = await createTeam({ name: 'A' });
    // OSS allows a single team, so team B only needs to be a distinct id.
    const teamB = new mongoose.Types.ObjectId();
    const { doc } = await create(teamA._id);

    expect(await listOrgApiKeys(teamB)).toHaveLength(0);
    expect(await deleteOrgApiKey(teamB, doc._id.toString())).toBeNull();
    expect(await OrgApiKey.findById(doc._id)).not.toBeNull();
  });

  it('writes lastUsedAt at most once per 5 minutes', async () => {
    const team = await createTeam({ name: 'A' });
    const { doc } = await create(team._id);
    const t0 = new Date();

    const lastUsed = async () => {
      // Writes are fire-and-forget; give them a moment to land.
      await new Promise(r => setTimeout(r, 100));
      return (await OrgApiKey.findById(doc._id))?.lastUsedAt?.getTime();
    };

    touchOrgApiKeyLastUsed(doc, t0);
    expect(await lastUsed()).toBe(t0.getTime());

    const fresh = (await OrgApiKey.findById(doc._id))!;
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
      const account = await User.findById(doc.serviceAccount);

      expect(account).toMatchObject({
        isServiceAccount: true,
        name: 'terraform',
      });
      expect(account?.team).toEqual(team._id);
      expect(account?.email).toMatch(
        /^sa-[0-9a-f]{24}@service-accounts\.hyperdx\.invalid$/,
      );
    });

    it('resolves the key to its service account', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc, key } = await create(team._id);
      const found = await findActiveOrgApiKey(key);
      expect(found?.serviceAccount._id).toEqual(doc.serviceAccount);
    });

    it('keeps service accounts out of members and personal-key auth', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc } = await create(team._id);
      const account = await User.findById(doc.serviceAccount);

      expect(await findUsersByTeam(team._id)).toHaveLength(0);
      expect(await findUserByAccessKey(account!.accessKey)).toBeNull();
    });

    it('renames the service account with the key', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc } = await create(team._id);
      await updateOrgApiKeyDescription(team._id, doc._id.toString(), 'ci');
      expect((await User.findById(doc.serviceAccount))?.name).toBe('ci');
    });

    it('keeps the service account when the key is revoked', async () => {
      const team = await createTeam({ name: 'A' });
      const { doc, key } = await create(team._id);
      await deleteOrgApiKey(team._id, doc._id.toString());
      expect(await findActiveOrgApiKey(key)).toBeNull();
      expect(await User.findById(doc.serviceAccount)).not.toBeNull();
    });
  });
});
