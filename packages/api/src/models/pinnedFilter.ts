import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export interface IPinnedFilter {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
  user: ObjectId | null; // null = team-level, non-null = personal
  fields: string[];
  filters: PinnedFiltersValue;
  createdAt: Date;
  updatedAt: Date;
}

const PinnedFilterSchema = new Schema<IPinnedFilter>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },
    source: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Source',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'User',
    },
    fields: {
      type: [String],
      default: [],
    },
    filters: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  },
);

// One document per team+source+user combination
// user=null means team-level pins
PinnedFilterSchema.index({ team: 1, source: 1, user: 1 }, { unique: true });

export default mongoose.model<IPinnedFilter>(
  'PinnedFilter',
  PinnedFilterSchema,
);
