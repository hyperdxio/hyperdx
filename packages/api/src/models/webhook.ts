import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import mongoose, { Schema } from 'mongoose';

export { WebhookService };

interface MongooseMap extends Map<string, string> {
  // https://mongoosejs.com/docs/api/map.html#MongooseMap.prototype.toJSON()
  // Converts this map to a native JavaScript Map for JSON.stringify(). Set the flattenMaps option to convert this map to a POJO instead.
  // doc.myMap.toJSON() instanceof Map; // true
  // doc.myMap.toJSON({ flattenMaps: true }) instanceof Map; // false
  toJSON: (options?: {
    flattenMaps?: boolean;
  }) => { [key: string]: any } | Map<string, any>;
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
  // reminder to serialize/convert the Mongoose model instance to a plain javascript object when using
  // to strip the additional properties that are related to the Mongoose internal representation -> webhook.headers.toJSON()
  queryParams?: MongooseMap;
  headers?: MongooseMap;
  body?: string;
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
      type: String,
      required: false,
    },
  },
  { timestamps: true },
);

export type WebhookDocument = mongoose.HydratedDocument<IWebhook>;

WebhookSchema.index({ team: 1, service: 1, name: 1 }, { unique: true });

export default mongoose.model<IWebhook>('Webhook', WebhookSchema);
