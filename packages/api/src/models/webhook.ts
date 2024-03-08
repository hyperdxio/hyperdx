import { ObjectId } from 'mongodb';
import mongoose, { Schema } from 'mongoose';

export enum WebhookService {
  Slack = 'slack',
  Generic = 'generic',
}

interface MongooseMap extends Map<string, string> {
  toJSON: () => { [key: string]: any };
}

export interface IWebhook {
  _id: ObjectId;
  createdAt: Date;
  name: string;
  service: WebhookService;
  team: ObjectId;
  updatedAt: Date;
  url?: string;
  description?: string;
  // reminder to serialize/convert the Mongoose model instance to a plain object or JSON when using
  // to strip the additional properties that are related to the Mongoose internal representation
  // IE webhook.headers.toJSON()
  queryParams?: MongooseMap;
  headers?: MongooseMap;
  body?: MongooseMap;
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
    description: {
      type: String,
      required: false,
    },
    queryParams: {
      type: Map,
      of: String,
      required: false,
    },
    headers: {
      type: Map,
      of: String,
      required: false,
    },
    body: {
      type: Map,
      of: String,
      required: false,
    },
  },
  { timestamps: true },
);

WebhookSchema.index({ team: 1, service: 1, name: 1 }, { unique: true });

export default mongoose.model<IWebhook>('Webhook', WebhookSchema);
