import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import type { ObjectId } from '@/models';
import PinnedFilterModel from '@/models/pinnedFilter';

/**
 * Get team-level pinned filters for a team+source combination.
 */
export async function getPinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
) {
  return PinnedFilterModel.findOne({
    team: new mongoose.Types.ObjectId(teamId),
    source: new mongoose.Types.ObjectId(sourceId),
    user: null,
  });
}

/**
 * Upsert team-level pinned filters for a team+source.
 */
export async function updatePinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
  data: { fields: string[]; filters: PinnedFiltersValue },
) {
  const filter = {
    team: new mongoose.Types.ObjectId(teamId),
    source: new mongoose.Types.ObjectId(sourceId),
    user: null,
  };

  return PinnedFilterModel.findOneAndUpdate(
    filter,
    {
      ...filter,
      fields: data.fields,
      filters: data.filters,
    },
    { upsert: true, new: true },
  );
}
