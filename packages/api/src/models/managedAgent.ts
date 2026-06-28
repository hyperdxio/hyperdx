import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

// References to a Claude Managed Agent provisioned on Anthropic for a team.
// Stores only non-secret identifiers (the agent/vault/environment IDs) so the
// agent can be listed, managed, and (later) used by an in-product receiver.
export interface IManagedAgent {
  _id: ObjectId;
  team: ObjectId;
  name: string;
  model: string;
  anthropicAgentId: string;
  vaultId: string;
  environmentId: string;
  mcpServerUrl: string;
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ManagedAgentSchema = new Schema<IManagedAgent>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    model: { type: String, required: true },
    anthropicAgentId: { type: String, required: true },
    vaultId: { type: String, required: true },
    environmentId: { type: String, required: true },
    mcpServerUrl: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true },
);

export type ManagedAgentDocument = mongoose.HydratedDocument<IManagedAgent>;

export default mongoose.model<IManagedAgent>(
  'ManagedAgent',
  ManagedAgentSchema,
);
