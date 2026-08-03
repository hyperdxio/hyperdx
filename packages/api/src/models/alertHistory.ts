import { AlertErrorType } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import ms from 'ms';

import { AlertState, IAlertError } from '@/models/alert';

import type { ObjectId } from '.';

export interface IAlertHistory {
  alert: ObjectId;
  counts: number;
  createdAt: Date;
  state: AlertState;
  lastValues: { startTime: Date; count: number }[];
  group?: string; // For group-by alerts, stores the group identifier
  fired?: boolean;
  /**
   * Errors recorded for this evaluation window. Present on ERROR-state rows
   * (query/processing failures where no normal history is written) and on
   * the ERROR row created alongside normal rows when notifications fail.
   */
  errors?: IAlertError[];
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
  fired: {
    type: Boolean,
    required: false,
  },
  errors: {
    type: [
      {
        _id: false,
        timestamp: { type: Date, required: true },
        type: {
          type: String,
          enum: AlertErrorType,
          required: true,
        },
        message: { type: String, required: true },
      },
    ],
    required: false,
    default: undefined,
  },
});

AlertHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

// Used by getRecentAlertHistories (matches on alert, sorts by createdAt)
AlertHistorySchema.index({ alert: 1, createdAt: -1 });

// Used by getPreviousAlertHistories (groups by {alert, group}, sorts by createdAt)
AlertHistorySchema.index({ alert: 1, group: 1, createdAt: -1 });

export default mongoose.model<IAlertHistory>(
  'AlertHistory',
  AlertHistorySchema,
);
