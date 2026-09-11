import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

// One managed-agent investigation kicked off by a firing alert. Correlates the
// Anthropic session back to the team + alert and, via the unique dedupeKey,
// keeps a level-triggered alert from starting a fresh investigation every
// evaluation window. Results live in the Anthropic session — nothing is
// delivered from here, so there is no delivery state to track. Holds no secrets.
interface IAgentRun {
  _id: ObjectId;
  team: ObjectId;
  managedAgent: ObjectId;
  anthropicSessionId: string;
  alertId?: string;
  // Per-alert, per-cooldown-window key (`${eventId}:${window}`) so a re-fire
  // within the window reuses the run while a later window re-investigates.
  // Unique index enforces the within-window collapse.
  dedupeKey: string;
  title: string;
  // Reserved for downstream extensions (see services/agentRunExtensions.ts):
  // persisted verbatim from onSessionStart's runMetadata. Core code never
  // interprets it.
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AgentRunSchema = new Schema<IAgentRun>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },
    managedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ManagedAgent',
      required: true,
    },
    anthropicSessionId: { type: String, required: true },
    alertId: { type: String, required: false },
    dedupeKey: { type: String, required: true },
    title: { type: String, required: true },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
  },
  { timestamps: true },
);

// Scoped to the team rather than global: the key is built from ObjectIds so a
// cross-team collision is already implausible, but tenancy shouldn't rest on
// that.
AgentRunSchema.index({ team: 1, dedupeKey: 1 }, { unique: true });

// Runs are short-lived operational records; expire them so the collection (and
// the dedupeKey space) doesn't grow unbounded.
AgentRunSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 14 },
);

export type AgentRunDocument = mongoose.HydratedDocument<IAgentRun>;

export default mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);
