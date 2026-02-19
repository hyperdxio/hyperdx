import { DashboardSchema } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';

import type { ObjectId } from '.';

export interface IDashboard extends z.infer<typeof DashboardSchema> {
  _id: ObjectId;
  team: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
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
      team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
      tags: {
        type: [String],
        default: [],
      },
      filters: { type: mongoose.Schema.Types.Array, default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    {
      timestamps: true,
      toJSON: { getters: true },
    },
  ),
);
