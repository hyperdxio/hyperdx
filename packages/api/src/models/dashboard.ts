import { DashboardSchema } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';

import type { ObjectId } from '.';

export interface IDashboard extends z.infer<typeof DashboardSchema> {
  _id: ObjectId;
  team: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  provisioned?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DashboardDocument = mongoose.HydratedDocument<IDashboard>;

export default mongoose.model<IDashboard>(
  'Dashboard',
  new Schema<IDashboard>(
    {
      name: {
        type: String,
        required: true,
      },
      tiles: { type: mongoose.Schema.Types.Mixed, required: true },
      // Immutable: `team` pins a dashboard to its owning tenant. Client PATCH
      // bodies are re-parsed against DashboardWithoutIdSchema (which declares
      // no `team`), so a smuggled key never reaches the update doc — this is
      // defense-in-depth for any other caller that spreads into an update.
      // The provisioner sets it via $setOnInsert only, which immutability
      // permits.
      team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        immutable: true,
      },
      tags: {
        type: [String],
        default: [],
      },
      filters: { type: mongoose.Schema.Types.Array, default: [] },
      savedQuery: { type: String, required: false },
      savedQueryLanguage: { type: String, required: false },
      savedFilterValues: { type: mongoose.Schema.Types.Array, required: false },
      savedDateRange: {
        type: mongoose.Schema.Types.Mixed,
        required: false,
      },
      containers: { type: mongoose.Schema.Types.Array, required: false },
      // Immutable: ownership attribution is set once at creation; updates
      // may only change `updatedBy`.
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        immutable: true,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
      },
      provisioned: { type: Boolean, default: false },
    },
    {
      timestamps: true,
      toJSON: { getters: true },
    },
  )
    .index(
      { name: 1, team: 1 },
      { unique: true, partialFilterExpression: { provisioned: true } },
    )
    // Serves team-scoped listings (IaC import manifest, external API list);
    // the partial {name, team} index above only covers provisioned dashboards.
    .index({ team: 1, _id: 1 }),
);
