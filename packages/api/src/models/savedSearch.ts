import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';

type ObjectId = mongoose.Types.ObjectId;

type ExternalSavedSearch = {
  id: string;
  name: string;
  select?: string;
  where?: string;
  whereLanguage?: string;
  orderBy?: string;
  sourceId?: string;
  tags?: string[];
  filters?: unknown[];
  teamId: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface ISavedSearch
  extends Omit<z.infer<typeof SavedSearchSchema>, 'source'> {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface ISavedSearchMethods {
  toExternalJSON(): ExternalSavedSearch;
}

const savedSearchSchema = new Schema<
  ISavedSearch,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  mongoose.Model<ISavedSearch, {}, ISavedSearchMethods>,
  ISavedSearchMethods
>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },

    name: String,
    select: String,
    where: String,
    whereLanguage: String,
    orderBy: String,
    source: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Source',
    },
    tags: [String],
    filters: [{ type: mongoose.Schema.Types.Mixed }],
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
  },
  {
    toJSON: { virtuals: true },
    timestamps: true,
  },
);

// Team-scoped list/count queries (e.g. external API pagination) filter on team
// and sort by _id. Compound so the sort is index-covered (no in-memory sort).
savedSearchSchema.index({ team: 1, _id: 1 });

savedSearchSchema.methods.toExternalJSON = function (): ExternalSavedSearch {
  return {
    id: String(this._id),
    name: this.name ?? '',
    select: this.select,
    where: this.where,
    whereLanguage: this.whereLanguage,
    orderBy: this.orderBy,
    sourceId: this.source ? String(this.source) : undefined,
    tags: this.tags,
    filters: this.filters,
    teamId: this.team ? String(this.team) : '',
    createdAt:
      this.createdAt instanceof Date ? this.createdAt.toISOString() : undefined,
    updatedAt:
      this.updatedAt instanceof Date ? this.updatedAt.toISOString() : undefined,
  };
};

export const SavedSearch = mongoose.model<
  ISavedSearch,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  mongoose.Model<ISavedSearch, {}, ISavedSearchMethods>
>('SavedSearch', savedSearchSchema);
