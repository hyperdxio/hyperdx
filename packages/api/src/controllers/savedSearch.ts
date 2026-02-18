import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import { groupBy, pick } from 'lodash';
import mongoose from 'mongoose';
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
    source: savedSearch.source.toString(),
    sources: savedSearch.sources?.map((s: mongoose.Types.ObjectId) =>
      s.toString(),
    ),
    alerts: alertsBySavedSearchId[savedSearch._id.toString()]?.map(alert => {
      return alert.toJSON();
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
  const payload: Record<string, unknown> = { ...savedSearch, team: teamId };
  if (Array.isArray(payload.sources) && payload.sources.length > 0) {
    payload.source = payload.sources[0];
  }
  return SavedSearch.create(payload as any);
}

export function updateSavedSearch(
  teamId: string,
  savedSearchId: string,
  savedSearch: SavedSearchWithoutId,
) {
  const payload: Record<string, unknown> = { ...savedSearch, team: teamId };
  if (Array.isArray(payload.sources) && payload.sources.length > 0) {
    payload.source = payload.sources[0];
  }
  return SavedSearch.findOneAndUpdate(
    { _id: savedSearchId, team: teamId },
    payload as any,
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
