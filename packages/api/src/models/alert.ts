import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export enum AlertThresholdType {
  ABOVE = 'above',
  BELOW = 'below',
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

export type AlertChannel =
  | {
      type: 'webhook';
      webhookId: string;
    }
  | {
      type: null;
    };

export enum AlertSource {
  SAVED_SEARCH = 'saved_search',
  TILE = 'tile',
}

export interface IAlert {
  _id: ObjectId;
  channel: AlertChannel;
  interval: AlertInterval;
  source: AlertSource;
  state: AlertState;
  team: ObjectId;
  threshold: number;
  thresholdType: AlertThresholdType;

  // Message template
  name?: string | null;
  message?: string | null;

  // SavedSearch alerts
  groupBy?: string;
  savedSearch?: ObjectId;

  // Tile alerts
  dashboard?: ObjectId;
  tileId?: string;

  // Silenced
  silenced?: {
    by?: ObjectId;
    at: Date;
    until: Date;
  };
}

export type AlertDocument = mongoose.HydratedDocument<IAlert>;

const AlertSchema = new Schema<IAlert>(
  {
    threshold: {
      type: Number,
      required: true,
    },
    thresholdType: {
      type: String,
      enum: AlertThresholdType,
      required: false,
    },
    interval: {
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
      default: AlertSource.SAVED_SEARCH,
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
    savedSearch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SavedSearch',
      required: false,
    },
    groupBy: {
      type: String,
      required: false,
    },

    // Chart alerts
    dashboard: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dashboard',
      required: false,
    },
    tileId: {
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
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IAlert>('Alert', AlertSchema);
