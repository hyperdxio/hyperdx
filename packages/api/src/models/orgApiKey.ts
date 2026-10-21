import type { OrgApiKeyScope } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

interface IOrgApiKey {
  _id: ObjectId;
  team: ObjectId;
  // SHA-256 of the plaintext key; the key itself is never stored.
  keyHash: string;
  description: string;
  scope: OrgApiKeyScope;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type OrgApiKeyDocument = mongoose.HydratedDocument<IOrgApiKey>;

const OrgApiKeySchema = new Schema<IOrgApiKey>(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    keyHash: { type: String, required: true },
    description: { type: String, required: true },
    scope: { type: String, enum: ['admin', 'member'], required: true },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

OrgApiKeySchema.index({ keyHash: 1 }, { unique: true });
OrgApiKeySchema.index({ team: 1 });

export default mongoose.model<IOrgApiKey>('OrgApiKey', OrgApiKeySchema);
