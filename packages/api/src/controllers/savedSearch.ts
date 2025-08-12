import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import { groupBy, pick } from 'lodash';
import { z } from 'zod';

import { deleteSavedSearchAlerts } from '@/controllers/alerts';
import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import type { IUser } from '@/models/user';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(teamId: string) {
  const savedSearches = await SavedSearch.find({ team: teamId });
  const alerts = await Alert.find(
    { team: teamId, savedSearch: { $exists: true, $ne: null } },
    { __v: 0 },
  ).populate('createdBy', 'email name');

  const alertsBySavedSearchId = groupBy(alerts, 'savedSearch');

  return savedSearches.map(savedSearch => ({
    ...savedSearch.toJSON(),
    alerts: alertsBySavedSearchId[savedSearch._id.toString()]?.map(alert => {
      const { _id, ...restAlert } = alert.toJSON();
      return { id: _id, ...restAlert };
    }),
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

export async function deleteSavedSearch(teamId: string, savedSearchId: string) {
  const savedSearch = await SavedSearch.findOneAndDelete({
    _id: savedSearchId,
    team: teamId,
  });
  if (savedSearch) {
    await deleteSavedSearchAlerts(savedSearchId, teamId);
  }
}
