import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import { Chart } from './dashboard';

export type AlertType = 'presence' | 'absence';

export enum SystemAlertName {
  ANOMALOUS_ERRORS = 'Anomalous HTTP Server Errors',
  ANOMALOUS_REQUESTS = 'Anomalous HTTP Successful Requests',
  ANOMALOUS_ERROR_EVENTS = 'Anomalous Error Events',
}

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

export type AlertSource = 'LOG' | 'CHART' | 'CUSTOM';

export type AlertCustomConfig = Pick<Chart, 'series'>;

export enum CheckerType {
  Anomaly = 'anomaly',
  Threshold = 'threshold',
}

interface AnomalyConfig {
  models?: AnomalyModel[];
  mode?: 'any' | 'combined';
}

export interface AnomalyModel {
  name: string;
  enabled: boolean;
  params: {
    [key: string]: unknown;
  };
}

export type CheckerConfig = AnomalyConfig;
export interface IAlert {
  _id: ObjectId;
  channel: AlertChannel;
  cron: string;
  interval: AlertInterval;
  source?: AlertSource;
  state: AlertState;
  team: ObjectId;
  threshold: number;
  timezone: string;
  type: AlertType;

  // Message template
  name?: string | null;
  message?: string | null;

  // Log alerts
  groupBy?: string;
  logView?: ObjectId;

  // Chart alerts
  dashboardId?: ObjectId;
  chartId?: string;

  // Silenced
  silenced?: {
    by?: ObjectId;
    at: Date;
    until: Date;
  };

  // System
  isSystem?: boolean;

  customConfig?: AlertCustomConfig;
  historyWindow?: number; // in minutes

  checker?: {
    type: CheckerType;
    config?: CheckerConfig;
  };
}

export type AlertDocument = mongoose.HydratedDocument<IAlert>;

interface IChecker {
  type: CheckerType;
  config?: CheckerConfig;
}

const checkerSchema = new Schema<IChecker>({
  type: {
    type: String,
    enum: Object.values(CheckerType),
    required: true,
  },
  config: {
    type: Schema.Types.Mixed,
    required: false,
  },
});

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
      required: false,
      default: 'LOG',
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
    },

    // Message template
    name: {
      type: String,
      required: false,
    },
    message: {
      type: String,
      required: false,
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
    silenced: {
      required: false,
      type: {
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
        at: {
          type: Date,
          required: true,
        },
        until: {
          type: Date,
          required: true,
        },
        required: false,
      },
    },
    isSystem: {
      type: Boolean,
      required: false,
      default: false,
    },
    customConfig: {
      type: Schema.Types.Mixed,
      required: false,
    },
    historyWindow: {
      type: Number,
      required: false,
    },
    checker: {
      type: checkerSchema,
      required: false,
      default: {
        type: CheckerType.Threshold,
      },
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IAlert>('Alert', AlertSchema);
