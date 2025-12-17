import {
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { ObjectId } from '@/models';
import PresetDashboardFilterModel from '@/models/presetDashboardFilter';

export async function getPresetDashboardFilters(
  teamId: string | ObjectId,
  source: string | ObjectId,
  presetDashboard: PresetDashboard,
) {
  return await PresetDashboardFilterModel.find({
    team: new mongoose.Types.ObjectId(teamId),
    source: new mongoose.Types.ObjectId(source),
    presetDashboard,
  });
}

export const createPresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboardFilter: PresetDashboardFilter,
) => {
  const newPresetDashboardFilter = new PresetDashboardFilterModel({
    ...presetDashboardFilter,
    team: new mongoose.Types.ObjectId(teamId),
  });

  return newPresetDashboardFilter.save();
};

export const updatePresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboardFilter: PresetDashboardFilter,
) => {
  return await PresetDashboardFilterModel.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(presetDashboardFilter.id),
      team: new mongoose.Types.ObjectId(teamId),
    },
    {
      ...presetDashboardFilter,
      _id: new mongoose.Types.ObjectId(presetDashboardFilter.id),
      team: new mongoose.Types.ObjectId(teamId),
    },
    { new: true },
  );
};

export const deletePresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboard: PresetDashboard,
  presetDashboardFilterId: string | ObjectId,
) => {
  return await PresetDashboardFilterModel.findOneAndDelete({
    _id: new mongoose.Types.ObjectId(presetDashboardFilterId),
    team: new mongoose.Types.ObjectId(teamId),
    presetDashboard,
  });
};
