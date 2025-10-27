import mongoose, { Schema } from 'mongoose';
import ms from 'ms';

import { AlertState } from '@/models/alert';

import type { ObjectId } from '.';

export interface IAlertHistory {
  alert: ObjectId;
  counts: number;
  createdAt: Date;
  state: AlertState;
  lastValues: { startTime: Date; count: number }[];
  group?: string; // For group-by alerts, stores the group identifier
}

const AlertHistorySchema = new Schema<IAlertHistory>({
  counts: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  alert: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
  state: {
    type: String,
    enum: Object.values(AlertState),
    required: true,
  },
  lastValues: [
    {
      startTime: {
        type: Date,
        required: true,
      },
      count: {
        type: Number,
        required: true,
      },
    },
  ],
  group: {
    type: String,
    required: false,
  },
});

AlertHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

AlertHistorySchema.index({ alert: 1, createdAt: -1 });
AlertHistorySchema.index({ alert: 1, group: 1, createdAt: -1 });

export default mongoose.model<IAlertHistory>(
  'AlertHistory',
  AlertHistorySchema,
);
