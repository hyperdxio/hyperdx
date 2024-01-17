import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export type AlertChannelPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type AlertChannelType = 'webhook';

export interface IAlertChannel {
  type: AlertChannelType;
  webhookId: string;
  priority?: AlertChannelPriority;
}

export type AlertChannelDocument = mongoose.HydratedDocument<IAlertChannel>;

// probably want some kind of uniqueness checking or naming
const AlertChannelSchema = new Schema<IAlertChannel>(
  {
    type: {
      type: String,
      required: true,
    },
    // storing this as a string for other types of channels
    webhookId: {
      type: String,
      required: true,
    },
    priority: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IAlertChannel>(
  'AlertChannel',
  AlertChannelSchema,
);
