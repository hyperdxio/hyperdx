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
  /** When true, `host` is treated as a Prometheus-compatible API endpoint
   *  (e.g. Prometheus or Thanos) and PromQL queries are proxied directly to
   *  it. When false/unset, `host` is a ClickHouse HTTP endpoint and PromQL
   *  queries use ClickHouse's prometheusQuery() function. */
  isPrometheusEndpoint?: boolean;
}

export type ConnectionDocument = mongoose.HydratedDocument<IConnection>;

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
      isPrometheusEndpoint: Boolean,
    },
    {
      timestamps: true,
      toJSON: { virtuals: true },
    },
  ),
);
