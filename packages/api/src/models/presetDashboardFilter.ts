import {
  MetricsDataType,
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export interface IPresetDashboardFilter
  extends Omit<PresetDashboardFilter, 'source'> {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
}

const PresetDashboardFilterSchema = new Schema<IPresetDashboardFilter>(
  {
    name: {
      type: String,
      required: true,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },
    source: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Source',
    },
    sourceMetricType: {
      type: String,
      required: false,
      enum: Object.values(MetricsDataType),
    },
    presetDashboard: {
      type: String,
      required: true,
      enum: Object.values(PresetDashboard),
    },
    type: { type: String, required: true },
    expression: { type: String, required: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  },
);

export default mongoose.model<IPresetDashboardFilter>(
  'PresetDashboardFilter',
  PresetDashboardFilterSchema,
);
