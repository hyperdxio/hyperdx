import { ObjectId } from 'mongodb';
import mongoose, { Schema } from 'mongoose';

export enum WebhookService {
  Slack = 'slack',
}

export interface IWebhook {
  _id: ObjectId;
  createdAt: Date;
  name: string;
  service: WebhookService;
  team: ObjectId;
  updatedAt: Date;
  url: string;
}

const WebhookSchema = new Schema<IWebhook>(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team' },
    service: {
      type: String,
      enum: Object.values(WebhookService),
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: false,
    },
  },
  { timestamps: true },
);

WebhookSchema.index({ team: 1, service: 1, name: 1 }, { unique: true });

export default mongoose.model<IWebhook>('Webhook', WebhookSchema);
