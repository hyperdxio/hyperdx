// TODO: TO BE DEPRECATED

import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export interface ILogView {
  _id: ObjectId;
  creator: ObjectId;
  name: string;
  query: string;
  team: ObjectId;
  tags: string[];
}

const LogViewSchema = new Schema<ILogView>(
  {
    query: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<ILogView>('LogView', LogViewSchema);
