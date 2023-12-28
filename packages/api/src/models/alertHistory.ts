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
});

AlertHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

export default mongoose.model<IAlertHistory>(
  'AlertHistory',
  AlertHistorySchema,
);
