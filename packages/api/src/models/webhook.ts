import { ObjectId } from 'mongodb';
import mongoose, { Schema } from 'mongoose';

export interface IWebhook {
  _id: ObjectId;
  createdAt: Date;
  name: string;
  service: string;
  team: ObjectId;
  updatedAt: Date;
  url: string;
}

export default mongoose.model<IWebhook>(
  'Webhook',
  new Schema<IWebhook>(
    {
      team: { type: Schema.Types.ObjectId, ref: 'Team' },
      service: String,
      name: String,
      url: String,
    },
    { timestamps: true },
  ),
);
