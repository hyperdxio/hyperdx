import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

export interface IConnection {
  _id: ObjectId;
  id: string;
  host: string;
  name: string;
  password: string;
  username: string;
  team: ObjectId;
  hyperdxSettingPrefix?: string;
  /** Optional Prometheus-compatible API endpoint (e.g. http://prometheus:9090).
   *  When set, PromQL queries are proxied to this endpoint instead of using
   *  ClickHouse's prometheusQuery() function. */
  prometheusEndpoint?: string;
}

export default mongoose.model<IConnection>(
  'Connection',
  new Schema<IConnection>(
    {
      team: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Team',
      },
      name: String,
      host: String,
      username: String,
      password: {
        type: String,
        select: false,
      },
      hyperdxSettingPrefix: String,
      prometheusEndpoint: String,
    },
    {
      timestamps: true,
      toJSON: { virtuals: true },
    },
  ),
);
