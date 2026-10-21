import type {
  CreateOrgApiKeyRequest,
  OrgApiKeyApiResponse,
  OrgApiKeyExpiry,
} from '@hyperdx/common-utils/dist/types';
import opentelemetry from '@opentelemetry/api';
import crypto from 'crypto';

import type { ObjectId } from '@/models';
import OrgApiKey, { type OrgApiKeyDocument } from '@/models/orgApiKey';
import type { IUser } from '@/models/user';
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
  { description, scope, expiry }: CreateOrgApiKeyRequest,
) {
  const key = `${ORG_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const doc = await OrgApiKey.create({
    team: teamId,
    keyHash: hashOrgApiKey(key),
    description,
    scope,
    expiresAt: expiresAtFor(expiry, Date.now()),
    createdBy,
  });
  return { doc, key };
}

export function listOrgApiKeys(teamId: string | ObjectId) {
  return OrgApiKey.find({ team: teamId })
    .sort({ createdAt: -1 })
    .populate<{ createdBy: IUser | null }>('createdBy', 'name email');
}

export function updateOrgApiKeyDescription(
  teamId: string | ObjectId,
  id: string,
  description: string,
) {
  return OrgApiKey.findOneAndUpdate(
    { _id: id, team: teamId },
    { description },
    { new: true },
  ).populate<{ createdBy: IUser | null }>('createdBy', 'name email');
}

export function deleteOrgApiKey(teamId: string | ObjectId, id: string) {
  return OrgApiKey.findOneAndDelete({ _id: id, team: teamId });
}

export async function findActiveOrgApiKey(key: string, now = new Date()) {
  if (!key.startsWith(ORG_API_KEY_PREFIX)) {
    return null;
  }
  return OrgApiKey.findOne({
    keyHash: hashOrgApiKey(key),
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  });
}

// Fire-and-forget so auth never waits on or fails because of this write. The
// conditional filter stops concurrent requests from all writing at once.
export function touchOrgApiKeyLastUsed(
  doc: OrgApiKeyDocument,
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
    scope: doc.scope,
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
