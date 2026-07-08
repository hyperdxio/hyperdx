import {
  SavedSearchListApiResponse,
  SavedSearchSchema,
} from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { z } from 'zod';

import { deleteSavedSearchAlerts } from '@/controllers/alerts';
import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import logger from '@/utils/logger';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(
  teamId: string,
): Promise<SavedSearchListApiResponse[]> {
  const savedSearches = await SavedSearch.find({ team: teamId })
    .populate('createdBy', 'email name')
    .populate('updatedBy', 'email name');
  const alerts = await Alert.find(
    { team: teamId, savedSearch: { $exists: true, $ne: null } },
    { __v: 0 },
  ).populate('createdBy', 'email name');

  const alertsBySavedSearchId = groupBy(alerts, 'savedSearch');

  return savedSearches.map(savedSearch => ({
    ...savedSearch.toJSON(),
    alerts: alertsBySavedSearchId[savedSearch._id.toString()]?.map(alert => {
      return alert.toJSON();
    }),
  }));
}

export function getSavedSearch(teamId: string, savedSearchId: string) {
  return SavedSearch.findOne({ _id: savedSearchId, team: teamId })
    .populate('createdBy', 'email name')
    .populate('updatedBy', 'email name');
}

export function createSavedSearch(
  teamId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return SavedSearch.create({
    ...savedSearch,
    team: teamId,
    createdBy: userId,
    updatedBy: userId,
  });
}

export function updateSavedSearch(
  teamId: string,
  savedSearchId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return SavedSearch.findOneAndUpdate(
    { _id: savedSearchId, team: teamId },
    {
      ...savedSearch,
      team: teamId,
      updatedBy: userId,
    },
    { new: true },
  );
}

export async function deleteSavedSearch(teamId: string, savedSearchId: string) {
  const savedSearch = await SavedSearch.findOne({
    _id: savedSearchId,
    team: teamId,
  });
  if (savedSearch == null) {
    return null;
  }
  // Delete dependent alerts before the parent. Without a transaction (which
  // requires a replica set), the deletes are not atomic, so this order picks
  // the least-bad partial-failure mode: if deleteSavedSearchAlerts throws,
  // nothing is deleted and the caller can retry. If the final deleteOne throws
  // after the alerts are gone, the search survives without its alerts —
  // recoverable by re-creating alerts, and strictly better than the reverse
  // order's failure mode (orphaned alerts pointing at a deleted saved search).
  await deleteSavedSearchAlerts(savedSearchId, teamId);
  await SavedSearch.deleteOne({ _id: savedSearchId, team: teamId });
  // Re-sweep after the parent is gone: a concurrent alert-create targeting this
  // saved search could land between the two deletes above and orphan itself.
  // Once the parent no longer exists this second sweep cleans up any such alert
  // (and is a cheap no-op in the common case). Best-effort: the parent is
  // already deleted, so the operation has succeeded from the caller's view — a
  // failure here must not surface as a 500. Log it so the (rare) orphan window
  // is observable and can be swept later, and still return success.
  try {
    await deleteSavedSearchAlerts(savedSearchId, teamId);
  } catch (e) {
    logger.warn(
      { err: e, savedSearchId, team: teamId },
      'Post-delete alert re-sweep failed; a concurrently-created alert may be orphaned for this deleted saved search',
    );
  }
  return savedSearch;
}
