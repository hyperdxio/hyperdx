import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

interface IPinnedFilter {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
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

// One document per team+source combination
PinnedFilterSchema.index({ team: 1, source: 1 }, { unique: true });

export default mongoose.model<IPinnedFilter>(
  'PinnedFilter',
  PinnedFilterSchema,
);
