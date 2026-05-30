import { SmartViewSchema } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';

import type { ObjectId } from '.';

export interface ISmartView extends z.infer<typeof SmartViewSchema> {
  _id: ObjectId;
  team: ObjectId;
  owner: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type SmartViewDocument = mongoose.HydratedDocument<ISmartView>;

const smartViewSchema = new Schema<ISmartView>(
  {
    name: {
      type: String,
      required: true,
      maxlength: 120,
    },
    icon: {
      type: String,
      required: false,
      maxlength: 64,
    },
    resource: {
      type: String,
      required: true,
      enum: ['dashboard', 'savedSearch'],
    },
    // Stored as Mixed; the Zod schema in @hyperdx/common-utils is the
    // source of truth for shape. PR-3 widens the rule union (non-tag
    // kinds) additively; existing documents keep parsing.
    rules: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: [],
    },
    combinator: {
      type: String,
      required: true,
      enum: ['all', 'any'],
      default: 'all',
    },
    ordering: {
      type: Number,
      required: true,
      default: 0,
    },
    isShared: {
      type: Boolean,
      required: true,
      default: false,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

// The listing query is always scoped to (team, owner, resource) and
// sorted by ordering. Mirrors the unique index pattern from
// favorite.ts but without the unique constraint: a user can name two
// views the same intentionally (e.g. "checkout" dashboards vs
// "checkout" saved searches across resources, or two iterations
// during editing).
smartViewSchema.index({ team: 1, owner: 1, resource: 1, ordering: 1 });

export default mongoose.model<ISmartView>('SmartView', smartViewSchema);
