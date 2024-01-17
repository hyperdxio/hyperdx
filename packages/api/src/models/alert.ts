import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

import type { IAlertChannel } from './alertChannel';

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

export type AlertSource = 'LOG' | 'CHART';

export interface IAlert {
  _id: ObjectId;
  channel: IAlertChannel;
  cron: string;
  interval: AlertInterval;
  source?: AlertSource;
  state: AlertState;
  team: ObjectId;
  threshold: number;
  timezone: string;
  type: AlertType;

  // Log alerts
  groupBy?: string;
  logView?: ObjectId;
  message?: string;

  // Chart alerts
  dashboardId?: ObjectId;
  chartId?: string;
}

export type AlertDocument = mongoose.HydratedDocument<IAlert>;

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
    channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AlertChannel',
    },
    state: {
      type: String,
      enum: AlertState,
      default: AlertState.OK,
    },
    source: {
      type: String,
      required: false,
      default: 'LOG',
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
    },

    // Log alerts
    logView: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LogView',
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
