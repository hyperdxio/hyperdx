import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import type { ObjectId } from '@/models';
import PinnedFilterModel from '@/models/pinnedFilter';

/**
 * Get pinned filters for a team+source combination.
 * Returns both the team-level document (user=null) and the personal
 * document for the given user, if any.
 */
export async function getPinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
  userId: string | ObjectId,
) {
  const docs = await PinnedFilterModel.find({
    team: new mongoose.Types.ObjectId(teamId),
    source: new mongoose.Types.ObjectId(sourceId),
    $or: [
      { user: null }, // team-level
      { user: new mongoose.Types.ObjectId(userId) }, // personal
    ],
  });

  const team = docs.find(d => d.user == null) ?? null;
  const personal = docs.find(d => d.user != null) ?? null;

  return { team, personal };
}

/**
 * Upsert pinned filters for a team+source.
 * When userId is null, updates team-level pins.
 * When userId is provided, updates personal pins for that user.
 */
export async function updatePinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
  userId: string | ObjectId | null,
  data: { fields: string[]; filters: PinnedFiltersValue },
) {
  const filter = {
    team: new mongoose.Types.ObjectId(teamId),
    source: new mongoose.Types.ObjectId(sourceId),
    user: userId ? new mongoose.Types.ObjectId(userId) : null,
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
