import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

// One managed-agent investigation kicked off by a firing alert. Correlates the
// Anthropic session back to the team + alert and records where its result should
// be delivered, so the polling sweep can pick it up later. Holds no secrets.
// `delivering` is a transient claim a poll sweep takes before posting to Slack,
// so concurrent sweeps can't double-deliver; it returns to `running` if the
// delivering process dies (reclaimed by the poller) or `delivered`/`failed` once
// the post resolves.
type AgentRunStatus = 'running' | 'delivering' | 'delivered' | 'failed';

interface IAgentRun {
  _id: ObjectId;
  team: ObjectId;
  managedAgent: ObjectId;
  anthropicSessionId: string;
  alertId?: string;
  status: AgentRunStatus;
  // Slack incoming-webhook URL the summary is posted to when the session idles.
  deliverToUrl: string;
  // Per-alert, per-cooldown-window key (`${alertId}:${eventId}:${window}`) so a
  // re-fire within the window reuses the run while a later window re-investigates.
  // Unique index enforces the within-window collapse.
  dedupeKey: string;
  title: string;
  // Reserved for downstream extensions (see services/agentRunExtensions.ts):
  // persisted verbatim from onSessionStart's runMetadata so extensions can
  // read their own state back at delivery time. Core code never interprets it.
  metadata?: Record<string, unknown>;
  // Delivery attempts, so a broken Slack target fails with the real reason after
  // a cap instead of re-posting every sweep until the age ceiling.
  attempts: number;
  deliveredAt?: Date;
  error?: string;
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
    status: {
      type: String,
      enum: ['running', 'delivering', 'delivered', 'failed'],
      required: true,
      default: 'running',
      index: true,
    },
    deliverToUrl: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    attempts: { type: Number, required: true, default: 0 },
    deliveredAt: { type: Date, required: false },
    error: { type: String, required: false },
  },
  { timestamps: true },
);

// Runs are short-lived operational records; expire them so the collection (and
// the unique dedupeKey space) doesn't grow unbounded.
AgentRunSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 14 },
);

export type AgentRunDocument = mongoose.HydratedDocument<IAgentRun>;

export default mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);
