import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export interface IDashboard {
  _id: ObjectId;
  name: string;
  query: string;
  team: ObjectId;
  charts: any[]; // TODO: Type this eventually
}

const DashboardSchema = new Schema<IDashboard>(
  {
    name: {
      type: String,
      required: true,
    },
    query: String,
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    charts: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IDashboard>('Dashboard', DashboardSchema);
