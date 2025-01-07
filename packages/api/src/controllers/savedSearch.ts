import { z } from 'zod';

import { SavedSearchSchema } from '@/common/commonTypes';
import { SavedSearch } from '@/models/savedSearch';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export function getSavedSearches(teamId: string) {
  return SavedSearch.find({
    team: teamId,
  });
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
