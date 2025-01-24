import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { z } from 'zod';

import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(teamId: string) {
  const savedSearches = await SavedSearch.find({ team: teamId });
  const alerts = await Alert.find(
    { team: teamId, savedSearch: { $exists: true, $ne: null } },
    { __v: 0 },
  );

  const alertsBySavedSearchId = groupBy(alerts, 'savedSearch');

  return savedSearches.map(savedSearch => ({
    ...savedSearch.toJSON(),
    alerts: alertsBySavedSearchId[savedSearch._id.toString()]
      ?.map(alert => alert.toJSON())
      .map(({ _id, ...alert }) => ({ id: _id, ...alert })), // Remap _id to id
  }));
}

export function getSavedSearch(teamId: string, savedSearchId: string) {
  return SavedSearch.findOne({ _id: savedSearchId, team: teamId });
}

export function createSavedSearch(
  teamId: string,
  savedSearch: SavedSearchWithoutId,
) {
  return SavedSearch.create({ ...savedSearch, team: teamId });
}

export function updateSavedSearch(
  teamId: string,
  savedSearchId: string,
  savedSearch: SavedSearchWithoutId,
) {
  return SavedSearch.findOneAndUpdate(
    { _id: savedSearchId, team: teamId },
    {
      ...savedSearch,
      team: teamId,
    },
    { new: true },
  );
}

export function deleteSavedSearch(teamId: string, savedSearchId: string) {
  return SavedSearch.findOneAndDelete({ _id: savedSearchId, team: teamId });
}
