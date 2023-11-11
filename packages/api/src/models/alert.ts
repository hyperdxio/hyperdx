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

export enum AlertSource {
  LOG = 'LOG',
  CHART = 'CHART',
}

export interface IAlert {
  _id: ObjectId;
  channel: AlertChannel;
  cron: string;
  interval: AlertInterval;
  state: AlertState;
  threshold: number;
  timezone: string;
  type: AlertType;
  source?: AlertSource;

  // Log alerts
  groupBy?: string;
  logView?: ObjectId;
  message?: string;

  // Chart alerts
  dashboardId?: ObjectId;
  chartId?: string;
}

const AlertSchema = new Schema<IAlert>(
  {
    type: {
      type: String,
      required: true,
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
    state: {
      type: String,
      enum: AlertState,
      default: AlertState.OK,
    },
    source: {
      type: String,
      enum: AlertSource,
      required: false,
      default: AlertSource.LOG,
    },

    // Log alerts
    logView: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Alert',
      required: false,
    },
    groupBy: {
      type: String,
      required: false,
    },
    message: {
      type: String,
      required: false,
    },

    // Chart alerts
    dashboardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dashboard',
      required: false,
    },
    chartId: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IAlert>('Alert', AlertSchema);
