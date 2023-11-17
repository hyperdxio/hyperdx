import mongoose, { Schema } from 'mongoose';

import { AggFn } from '../clickhouse';

import type { ObjectId } from '.';

type Chart = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  series: (
    | {
        table: string;
        type: 'time';
        aggFn: AggFn; // TODO: Type
        field: string | undefined;
        where: string;
        groupBy: string[];
      }
    | {
        table: string;
        type: 'histogram';
        field: string | undefined;
        where: string;
      }
    | {
        type: 'search';
        fields: string[];
        where: string;
      }
    | {
        type: 'number';
        table: string;
        aggFn: AggFn;
        field: string | undefined;
        where: string;
      }
    | {
        type: 'table';
        table: string;
        aggFn: AggFn;
        field: string | undefined;
        where: string;
        groupBy: string[];
        sortOrder: 'desc' | 'asc';
      }
    | {
        type: 'markdown';
        content: string;
      }
  )[];
};

export interface IDashboard {
  _id: ObjectId;
  name: string;
  query: string;
  team: ObjectId;
  charts: Chart[];
}

const DashboardSchema = new Schema<IDashboard>(
  {
    name: {
      type: String,
      required: true,
    },
    query: String,
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    charts: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IDashboard>('Dashboard', DashboardSchema);
