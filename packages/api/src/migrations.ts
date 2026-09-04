import mongoose from 'mongoose';

import Alert, { IAlert } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { deriveAlertNameAndTags } from '@/utils/alerts';
import logger from '@/utils/logger';

const BACKFILL_BATCH_SIZE = 500;

const NAME_MISSING_FILTER = { name: { $in: [null, ''] } };
const TAGS_MISSING_FILTER = { tags: null };

export async function backfillAlertNameAndTags() {
  const ids = (
    await Alert.find(
      { $or: [NAME_MISSING_FILTER, TAGS_MISSING_FILTER] },
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
        name: 1,
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
      update: { $set: { name: string } | { tags: string[] } };
    }[] = [];
    for (const alert of batch) {
      const { name, tags } = deriveAlertNameAndTags(
        alert,
        alert.savedSearch != null
          ? savedSearchById.get(String(alert.savedSearch))
          : undefined,
        alert.dashboard != null
          ? dashboardById.get(String(alert.dashboard))
          : undefined,
      );
      const hasName = typeof alert.name === 'string' && alert.name !== '';
      const hasTags = alert.tags != null;

      const inputsUnchangedFilter = {
        source: alert.source ?? null,
        savedSearch: alert.savedSearch ?? null,
        dashboard: alert.dashboard ?? null,
        tileId: alert.tileId ?? null,
        'chartConfig.name': alert.chartConfig?.name ?? null,
      };
      if (!hasName && name != null) {
        ops.push({
          filter: {
            _id: alert._id,
            ...inputsUnchangedFilter,
            ...NAME_MISSING_FILTER,
          },
          update: { $set: { name } },
        });
      }
      if (!hasTags && tags.length > 0) {
        ops.push({
          filter: {
            _id: alert._id,
            ...inputsUnchangedFilter,
            ...TAGS_MISSING_FILTER,
          },
          update: { $set: { tags } },
        });
      }
    }

    if (ops.length > 0) {
      const result = await Alert.bulkWrite(
        ops.map(op => ({ updateOne: { ...op, timestamps: false } })),
        { ordered: false },
      );
      updatedCount += result.modifiedCount;
    }
  }

  logger.info(
    { scannedCount: ids.length, updatedCount },
    'Backfilled alert names and tags',
  );
}

export async function runStartupMigrations() {
  try {
    await backfillAlertNameAndTags();
  } catch (e) {
    logger.error({ err: e }, 'Error backfilling alert names and tags');
  }
}
