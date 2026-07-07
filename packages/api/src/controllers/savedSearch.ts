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
  // Delete referencing alerts first so a failure after this step doesn't
  // orphan them (the search still exists and a retry will succeed).
  await deleteSavedSearchAlerts(savedSearchId, teamId);
  return SavedSearch.findOneAndDelete({
    _id: savedSearchId,
    team: teamId,
  });
}

/**
 * Full-replace update for a saved search. Sets the provided fields and
 * explicitly $unsets the fields listed in `unsetFields` so that omitted
 * optional fields are deterministically cleared rather than left stale.
 */
export function replaceSavedSearch(
  teamId: string,
  savedSearchId: string,
  fieldsToSet: Partial<SavedSearchWithoutId & { updatedBy?: string }>,
  unsetFields: string[],
) {
  const $unset: Record<string, ''> = {};
  for (const field of unsetFields) {
    $unset[field] = '';
  }
  return SavedSearch.findOneAndUpdate(
    { _id: savedSearchId, team: teamId },
    {
      $set: fieldsToSet,
      ...(unsetFields.length > 0 ? { $unset } : {}),
    },
    { new: true },
  );
}
