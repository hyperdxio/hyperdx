import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(teamId: string) {
  const savedSearches = await SavedSearch.find({
    team: teamId,
  });
  const alerts = await Promise.all(
    savedSearches.map(({ _id }) =>
      Alert.find({ savedSearch: _id }, { __v: 0 }),
    ),
  );

  return savedSearches.map((savedSearch, index) => ({
    ...savedSearch.toJSON(),
    // Remap _id to id
    alerts: alerts[index]
      .map(alert => alert.toJSON())
      .map(({ _id, ...alert }) => ({ id: _id, ...alert })),
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
