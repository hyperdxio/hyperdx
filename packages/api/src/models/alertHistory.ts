import mongoose, { Schema } from 'mongoose';
import ms from 'ms';

import type { ObjectId } from '.';
import { AlertState } from '@/models/alert';

export interface IAlertHistory {
  alert: ObjectId;
  counts: number;
  createdAt: Date;
  state: AlertState;
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
});

AlertHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

export default mongoose.model<IAlertHistory>(
  'AlertHistory',
  AlertHistorySchema,
);
