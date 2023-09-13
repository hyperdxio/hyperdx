import mongoose, { Schema } from 'mongoose';
import ms from 'ms';

import type { ObjectId } from '.';

export interface IAlertHistory {
  alert: ObjectId;
  counts: number;
  createdAt: Date;
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
});

AlertHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

export default mongoose.model<IAlertHistory>(
  'AlertHistory',
  AlertHistorySchema,
);
