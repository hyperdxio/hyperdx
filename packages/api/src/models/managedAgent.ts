import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

// References to a Claude Managed Agent provisioned on Anthropic for a team.
// Stores only non-secret identifiers (the agent/vault/environment IDs) so the
// agent can be listed, managed, and (later) used by an in-product receiver.
interface IManagedAgent {
  _id: ObjectId;
  team: ObjectId;
  name: string;
  /** Absent on an imported agent whose Anthropic record could not be read. */
  model?: string;
  /**
   * Team-authored brief appended to the standing SRE prompt at provisioning
   * time, so one team can run (say) a database specialist alongside a general
   * responder. Baked into the Anthropic agent object, so editing it means
   * re-provisioning — kept here for display and for that rebuild.
   */
  instructions?: string;
  anthropicAgentId: string;
  vaultId: string;
  environmentId: string;
  mcpServerUrl: string;
  /**
   * True when the agent object itself was written outside HyperDX and only
   * linked here. HyperDX still provisions the environment and vault an
   * imported agent needs, so deleting one tears down exactly those two and
   * leaves the user's agent on Anthropic.
   */
  imported?: boolean;
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
    model: { type: String, required: false },
    instructions: { type: String, required: false },
    anthropicAgentId: { type: String, required: true },
    vaultId: { type: String, required: true },
    environmentId: { type: String, required: true },
    mcpServerUrl: { type: String, required: true },
    imported: { type: Boolean, required: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true },
);

// Import checks for an existing record before provisioning, which is a
// check-then-act: two simultaneous imports of the same Anthropic agent would
// both pass and each leave behind a vault holding a live ClickStack key, with
// only one of them reachable to tear down. The index makes the loser fail.
ManagedAgentSchema.index({ team: 1, anthropicAgentId: 1 }, { unique: true });

export type ManagedAgentDocument = mongoose.HydratedDocument<IManagedAgent>;

export default mongoose.model<IManagedAgent>(
  'ManagedAgent',
  ManagedAgentSchema,
);
