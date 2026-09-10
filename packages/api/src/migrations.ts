import mongoose from 'mongoose';

import Alert, { IAlert } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { deriveAlertDisplayFields } from '@/utils/alerts';
import logger from '@/utils/logger';

const BACKFILL_BATCH_SIZE = 500;

const DISPLAY_NAME_MISSING_FILTER = { displayName: { $in: [null, ''] } };
// Matches missing/null only: an existing [] means the user cleared the tags,
// so it is left alone.
const TAGS_MISSING_FILTER = { tags: null };

export async function backfillAlertDisplayFields() {
  const ids = (
    await Alert.find(
      { $or: [DISPLAY_NAME_MISSING_FILTER, TAGS_MISSING_FILTER] },
      { _id: 1 },
    ).lean()
  ).map(doc => doc._id);
  if (ids.length === 0) {
    return;
  }

  let updatedCount = 0;
  for (let i = 0; i < ids.length; i += BACKFILL_BATCH_SIZE) {
    const batch = await Alert.find(
      { _id: { $in: ids.slice(i, i + BACKFILL_BATCH_SIZE) } },
      {
        displayName: 1,
        tags: 1,
        source: 1,
        savedSearch: 1,
        dashboard: 1,
        tileId: 1,
        'chartConfig.name': 1,
      },
    ).lean();

    const savedSearchIds = batch
      .map(a => a.savedSearch)
      .filter(id => id != null);
    const dashboardIds = batch.map(a => a.dashboard).filter(id => id != null);
    const [savedSearches, dashboards] = await Promise.all([
      savedSearchIds.length > 0
        ? SavedSearch.find(
            { _id: { $in: savedSearchIds } },
            { name: 1, tags: 1 },
          ).lean()
        : [],
      dashboardIds.length > 0
        ? Dashboard.find(
            { _id: { $in: dashboardIds } },
            { name: 1, tags: 1, 'tiles.id': 1, 'tiles.config.name': 1 },
          ).lean()
        : [],
    ]);
    const savedSearchById = new Map(
      savedSearches.map(d => [String(d._id), d] as const),
    );
    const dashboardById = new Map(
      dashboards.map(d => [String(d._id), d] as const),
    );

    const ops: {
      filter: mongoose.FilterQuery<IAlert>;
      update: { $set: { displayName: string } | { tags: string[] } };
    }[] = [];
    for (const alert of batch) {
      const derived = deriveAlertDisplayFields(alert, {
        savedSearch:
          alert.savedSearch != null
            ? savedSearchById.get(String(alert.savedSearch))
            : undefined,
        dashboard:
          alert.dashboard != null
            ? dashboardById.get(String(alert.dashboard))
            : undefined,
      });
      const hasDisplayName =
        typeof alert.displayName === 'string' && alert.displayName !== '';
      const hasTags = alert.tags != null;

      const inputsUnchangedFilter = {
        source: alert.source ?? null,
        savedSearch: alert.savedSearch ?? null,
        dashboard: alert.dashboard ?? null,
        tileId: alert.tileId ?? null,
        'chartConfig.name': alert.chartConfig?.name ?? null,
      };
      if (!hasDisplayName && derived.displayName != null) {
        ops.push({
          filter: {
            _id: alert._id,
            ...inputsUnchangedFilter,
            ...DISPLAY_NAME_MISSING_FILTER,
          },
          update: { $set: { displayName: derived.displayName } },
        });
      }
      if (!hasTags && derived.tags != null && derived.tags.length > 0) {
        ops.push({
          filter: {
            _id: alert._id,
            ...inputsUnchangedFilter,
            ...TAGS_MISSING_FILTER,
          },
          update: { $set: { tags: derived.tags } },
        });
      }
    }

    if (ops.length > 0) {
      // timestamps: false (per op — the bulkWrite-level option only covers
      // inserts) keeps the backfill from bumping updatedAt, which is
      // user-visible and implies a user edit.
      const result = await Alert.bulkWrite(
        ops.map(op => ({ updateOne: { ...op, timestamps: false } })),
        { ordered: false },
      );
      updatedCount += result.modifiedCount;
    }
  }

  logger.info(
    { scannedCount: ids.length, updatedCount },
    'Backfilled alert display names and tags',
  );
}

export async function runStartupMigrations() {
  try {
    await backfillAlertDisplayFields();
  } catch (e) {
    logger.error({ err: e }, 'Error backfilling alert display names and tags');
  }
}
