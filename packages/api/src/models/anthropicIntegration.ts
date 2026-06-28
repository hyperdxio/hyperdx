import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

// A team's Anthropic API key, encrypted at rest (see utils/encryption.ts).
// One per team. `encryptedApiKey` is `select: false` so it is never returned
// unless explicitly requested; `keyHint` (last 4 chars) is safe to display.
export interface IAnthropicIntegration {
  _id: ObjectId;
  team: ObjectId;
  encryptedApiKey: string;
  keyHint: string;
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AnthropicIntegrationSchema = new Schema<IAnthropicIntegration>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      unique: true,
    },
    encryptedApiKey: { type: String, required: true, select: false },
    keyHint: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true },
);

export type AnthropicIntegrationDocument =
  mongoose.HydratedDocument<IAnthropicIntegration>;

export default mongoose.model<IAnthropicIntegration>(
  'AnthropicIntegration',
  AnthropicIntegrationSchema,
);
