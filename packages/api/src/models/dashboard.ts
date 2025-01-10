import mongoose, { Schema } from 'mongoose';

import { SourceTable } from '@/utils/zod';

import { AggFn, SeriesReturnType } from '../clickhouse';
import type { ObjectId } from '.';

// Based on numbro.js format
// https://numbrojs.com/format.html
type NumberFormat = {
  output?: 'currency' | 'percent' | 'byte' | 'time' | 'number';
  mantissa?: number;
  thousandSeparated?: boolean;
  average?: boolean;
  decimalBytes?: boolean;
  factor?: number;
  currencySymbol?: string;
  unit?: string;
};

export type Chart = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  series: (
    | {
        table: SourceTable;
        type: 'time';
        aggFn: AggFn; // TODO: Type
        field: string | undefined;
        where: string;
        groupBy: string[];
        numberFormat?: NumberFormat;
      }
    | {
        table: SourceTable;
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
        table: SourceTable;
        aggFn: AggFn;
        field: string | undefined;
        where: string;
        numberFormat?: NumberFormat;
      }
    | {
        type: 'table';
        table: SourceTable;
        aggFn: AggFn;
        field: string | undefined;
        where: string;
        groupBy: string[];
        sortOrder: 'desc' | 'asc';
        numberFormat?: NumberFormat;
      }
    | {
        type: 'markdown';
        content: string;
      }
  )[];
  seriesReturnType?: SeriesReturnType;
};

export interface IDashboard {
  _id: ObjectId;
  name: string;
  query: string;
  team: ObjectId;
  charts: Chart[];
  tags: string[];
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
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IDashboard>('Dashboard', DashboardSchema);
