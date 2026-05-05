import {
  SavedSearchListApiResponse,
  SavedSearchSchema,
} from '@berg/common-utils/dist/types';
import { z } from 'zod';

import { SavedSearch } from '@/models/savedSearch';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(
  teamId: string,
): Promise<SavedSearchListApiResponse[]> {
  const savedSearches = await SavedSearch.find({ team: teamId })
    .populate('createdBy', 'email name')
    .populate('updatedBy', 'email name');

  return savedSearches.map(savedSearch => savedSearch.toJSON());
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
  await SavedSearch.findOneAndDelete({
    _id: savedSearchId,
    team: teamId,
  });
}
