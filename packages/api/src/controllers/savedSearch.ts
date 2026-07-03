import {
  SavedSearchListApiResponse,
  SavedSearchSchema,
} from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { z } from 'zod';

import { deleteSavedSearchAlerts } from '@/controllers/alerts';
import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';

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
  // requires a replica set), deleting the parent first would leave orphaned
  // alerts pointing at a now-deleted saved search if alert deletion failed.
  // This order fails safe: a failure here leaves the saved search intact and
  // the caller can retry.
  await deleteSavedSearchAlerts(savedSearchId, teamId);
  await SavedSearch.deleteOne({ _id: savedSearchId, team: teamId });
  return savedSearch;
}
