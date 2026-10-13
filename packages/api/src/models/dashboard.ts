import { DashboardSchema } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema, UpdateQuery } from 'mongoose';
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
  version: number;
}

export type DashboardDocument = mongoose.HydratedDocument<IDashboard>;

// Strips a client-supplied `version` from an update the way mongoose's own
// timestamps plugin strips a client-supplied `updatedAt`: keeps the field
// server-owned, and avoids a hard Mongo error, since `$set: { version: n }`
// alongside the `$inc` below would conflict.
function stripClientSuppliedVersion(
  update: UpdateQuery<IDashboard> | null | undefined,
) {
  if (update == null) return;
  delete update.version;
  if (update.$set) delete update.$set.version;
  if (update.$setOnInsert) delete update.$setOnInsert.version;
}

const dashboardSchema = new Schema<IDashboard>(
  {
    name: {
      type: String,
      required: true,
    },
    tiles: { type: mongoose.Schema.Types.Mixed, required: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    provisioned: { type: Boolean, default: false },
    // Optimistic-concurrency counter. Server-owned via the middleware below
    // rather than by discipline at each write call site — see
    // `@/utils/dashboardVersion.ts` for why this replaced `updatedAt` as the
    // guard token.
    version: { type: Number, default: 0 },
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
  .index({ team: 1, _id: 1 });

// Every update operation bumps `version`, so a write path added later gets
// the concurrency guard for free without having to remember to do it.
dashboardSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function (next) {
    const update = this.getUpdate();
    // An aggregation-pipeline update is an array, with nowhere to hang the
    // `$inc` below, so the counter would silently stop advancing and stale
    // writes would start passing the guard. No call site uses one; fail
    // loudly rather than let a future one slip past.
    if (Array.isArray(update)) {
      return next(
        new Error(
          'Dashboard updates cannot use an aggregation pipeline: the version counter needs $inc',
        ),
      );
    }
    stripClientSuppliedVersion(update);
    if (update != null) {
      update.$inc = { ...update.$inc, version: 1 };
    }
    next();
  },
);

// `save()` on a brand-new document already gets `version: 0` from the
// schema default; incrementing here too would start it at 1 instead.
dashboardSchema.pre('save', function (next) {
  if (!this.isNew) {
    // A document hydrated under a projection that excludes `version` would
    // otherwise read back as `undefined`, defaulted to 0, and get written
    // back at 1 — silently rewinding the counter. Fail loudly instead: no
    // current call site saves such a document (see @/utils/dashboardVersion.ts),
    // so this should never fire, but a default would make it fire quietly.
    if (!this.isSelected('version')) {
      return next(
        new Error(
          'Cannot save a Dashboard document loaded with a projection that excludes version',
        ),
      );
    }
    this.version = this.get('version') + 1;
  }
  next();
});

export default mongoose.model<IDashboard>('Dashboard', dashboardSchema);
