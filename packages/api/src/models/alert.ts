import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export type AlertType = 'presence' | 'absence';

export enum AlertState {
  ALERT = 'ALERT',
  DISABLED = 'DISABLED',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  OK = 'OK',
}

// follow 'ms' pkg formats
export type AlertInterval =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '6h'
  | '12h'
  | '1d';

export type AlertChannel = {
  type: 'webhook';
  webhookId: string;
};

export interface IAlert {
  _id: ObjectId;
  channel: AlertChannel;
  cron: string;
  groupBy?: string;
  interval: AlertInterval;
  logView: ObjectId;
  message?: string;
  state: AlertState;
  threshold: number;
  timezone: string;
  type: AlertType;
}

const AlertSchema = new Schema<IAlert>(
  {
    type: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: false,
    },
    threshold: {
      type: Number,
      required: true,
    },
    interval: {
      type: String,
      required: true,
    },
    timezone: {
      type: String,
      required: true,
    },
    cron: {
      type: String,
      required: true,
    },
    channel: Schema.Types.Mixed, // slack, email, etc
    logView: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
    state: {
      type: String,
      enum: AlertState,
      default: AlertState.OK,
    },
    groupBy: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IAlert>('Alert', AlertSchema);
