import type {
  CreateOrgApiKeyRequest,
  OrgApiKeyApiResponse,
  OrgApiKeyExpiry,
} from '@hyperdx/common-utils/dist/types';
import opentelemetry from '@opentelemetry/api';
import crypto from 'crypto';
import mongoose from 'mongoose';

import {
  ACTIVE_ORG_API_KEY,
  createVirtualUser,
  hashOrgApiKey,
  ORG_API_KEY_PREFIX,
} from '@/controllers/user';
import type { ObjectId } from '@/models';
import User, { type IUser, type UserDocument } from '@/models/user';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

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

export async function createOrgApiKey(
  teamId: string | ObjectId,
  createdBy: string | ObjectId,
  { description, expiry }: CreateOrgApiKeyRequest,
) {
  const key = `${ORG_API_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  // `.invalid` is reserved, so the email can never reach a real inbox.
  const doc = await createVirtualUser({
    teamId,
    name: description,
    email: `sa-${crypto.randomBytes(12).toString('hex')}@service-accounts.hyperdx.invalid`,
    accessKey: hashOrgApiKey(key),
    expiresAt: expiresAtFor(expiry, Date.now()),
    createdBy: new mongoose.Types.ObjectId(createdBy),
  });
  return { doc, key };
}

export function listOrgApiKeys(teamId: string | ObjectId) {
  return User.find({ team: teamId, ...ACTIVE_ORG_API_KEY })
    .sort({ createdAt: -1 })
    .populate<{ createdBy: IUser | null }>('createdBy', 'name email');
}

export function updateOrgApiKeyDescription(
  teamId: string | ObjectId,
  id: string,
  description: string,
) {
  return User.findOneAndUpdate(
    { _id: id, team: teamId, ...ACTIVE_ORG_API_KEY },
    { name: description },
    { new: true },
  ).populate<{ createdBy: IUser | null }>('createdBy', 'name email');
}

// Marks rather than deletes, so anything the account created keeps its author.
export function revokeOrgApiKey(teamId: string | ObjectId, id: string) {
  return User.findOneAndUpdate(
    { _id: id, team: teamId, ...ACTIVE_ORG_API_KEY },
    { revokedAt: new Date() },
  );
}

// Fire-and-forget so auth never waits on or fails because of this write. The
// conditional filter stops concurrent requests from all writing at once.
export function touchOrgApiKeyLastUsed(
  doc: Pick<IUser, '_id' | 'lastUsedAt'>,
  now = new Date(),
) {
  const staleBefore = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS);
  if (doc.lastUsedAt != null && doc.lastUsedAt > staleBefore) {
    return;
  }
  // Captured now: the write settles after the request may have moved on.
  const span = opentelemetry.trace.getActiveSpan();
  void User.updateOne(
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
  doc: Omit<UserDocument, 'createdBy'> & {
    createdBy?: IUser | ObjectId | null;
  },
): OrgApiKeyApiResponse {
  const creator =
    doc.createdBy != null && 'email' in doc.createdBy ? doc.createdBy : null;
  return {
    id: doc._id.toString(),
    description: doc.name,
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
