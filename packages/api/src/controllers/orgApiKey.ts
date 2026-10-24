import type {
  CreateOrgApiKeyRequest,
  OrgApiKeyApiResponse,
  OrgApiKeyExpiry,
} from '@hyperdx/common-utils/dist/types';
import opentelemetry from '@opentelemetry/api';
import crypto from 'crypto';

import type { ObjectId } from '@/models';
import OrgApiKey, { type OrgApiKeyDocument } from '@/models/orgApiKey';
import User, { type IUser, type UserDocument } from '@/models/user';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

export const ORG_API_KEY_PREFIX = 'hdx_org_';

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const lastUsedWriteFailures = getCounter(
  'hyperdx.org_api_key.last_used_write_failures',
  { description: 'Failed writes of an org API key last-used time.' },
);

function expiresAtFor(expiry: OrgApiKeyExpiry, now: number): Date | null {
  switch (expiry) {
    case '30d':
      return new Date(now + 30 * DAY_MS);
    case '1y':
      return new Date(now + 365 * DAY_MS);
    case 'never':
      return null;
  }
}

export function hashOrgApiKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function createOrgApiKey(
  teamId: string | ObjectId,
  createdBy: string | ObjectId,
  { description, expiry }: CreateOrgApiKeyRequest,
) {
  const key = `${ORG_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  // `.invalid` is reserved, so the email can never reach a real inbox.
  const serviceAccount = await User.create({
    team: teamId,
    name: description,
    email: `sa-${crypto.randomBytes(12).toString('hex')}@service-accounts.hyperdx.invalid`,
    isServiceAccount: true,
  });
  try {
    const doc = await OrgApiKey.create({
      team: teamId,
      keyHash: hashOrgApiKey(key),
      description,
      expiresAt: expiresAtFor(expiry, Date.now()),
      createdBy,
      serviceAccount: serviceAccount._id,
    });
    return { doc, key };
  } catch (err) {
    // Don't leave a service account behind that no key points to.
    await User.deleteOne({ _id: serviceAccount._id });
    throw err;
  }
}

export function listOrgApiKeys(teamId: string | ObjectId) {
  return OrgApiKey.find({ team: teamId })
    .sort({ createdAt: -1 })
    .populate<{ createdBy: IUser | null }>('createdBy', 'name email');
}

export async function updateOrgApiKeyDescription(
  teamId: string | ObjectId,
  id: string,
  description: string,
) {
  const doc = await OrgApiKey.findOneAndUpdate(
    { _id: id, team: teamId },
    { description },
    { new: true },
  ).populate<{ createdBy: IUser | null }>('createdBy', 'name email');
  if (doc != null) {
    await User.updateOne(
      { _id: doc.serviceAccount, team: teamId },
      { name: description },
    );
  }
  return doc;
}

// Keeps the service account so anything it created still shows who made it.
export function deleteOrgApiKey(teamId: string | ObjectId, id: string) {
  return OrgApiKey.findOneAndDelete({ _id: id, team: teamId });
}

export async function findActiveOrgApiKey(key: string, now = new Date()) {
  if (!key.startsWith(ORG_API_KEY_PREFIX)) {
    return null;
  }
  const doc = await OrgApiKey.findOne({
    keyHash: hashOrgApiKey(key),
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).populate<{ serviceAccount: UserDocument | null }>('serviceAccount');
  const serviceAccount = doc?.serviceAccount;
  if (doc == null || serviceAccount == null) {
    return null;
  }
  return { orgApiKey: doc, serviceAccount };
}

// Fire-and-forget so auth never waits on or fails because of this write. The
// conditional filter stops concurrent requests from all writing at once.
export function touchOrgApiKeyLastUsed(
  doc: Pick<OrgApiKeyDocument, '_id' | 'lastUsedAt'>,
  now = new Date(),
) {
  const staleBefore = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS);
  if (doc.lastUsedAt != null && doc.lastUsedAt > staleBefore) {
    return;
  }
  // Captured now: the write settles after the request may have moved on.
  const span = opentelemetry.trace.getActiveSpan();
  void OrgApiKey.updateOne(
    {
      _id: doc._id,
      $or: [{ lastUsedAt: null }, { lastUsedAt: { $lt: staleBefore } }],
    },
    { lastUsedAt: now },
  ).catch(err => {
    lastUsedWriteFailures.add(1);
    span?.recordException(err instanceof Error ? err : new Error(String(err)));
    logger.warn(
      { error: err, orgApiKeyId: doc._id.toString() },
      'Failed to record org API key last use',
    );
  });
}

export function formatOrgApiKey(
  doc: Omit<OrgApiKeyDocument, 'createdBy'> & {
    createdBy: IUser | ObjectId | null;
  },
): OrgApiKeyApiResponse {
  const creator =
    doc.createdBy != null && 'email' in doc.createdBy ? doc.createdBy : null;
  return {
    id: doc._id.toString(),
    description: doc.description,
    createdAt: doc.createdAt.toISOString(),
    expiresAt: doc.expiresAt?.toISOString() ?? null,
    lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
    createdBy: creator
      ? {
          id: creator._id.toString(),
          name: creator.name,
          email: creator.email,
        }
      : null,
  };
}
