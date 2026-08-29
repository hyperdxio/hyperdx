import mongoose from 'mongoose';

import Alert, { AlertSource, IAlert } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import logger from '@/utils/logger';

const ALERT_NAME_MAX_LENGTH = 512;

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (tag): tag is string => typeof tag === 'string' && tag !== '',
  );
}

export function deriveAlertNameAndTags(
  alert: {
    source?: unknown;
    tileId?: unknown;
    chartConfig?: { name?: unknown } | null;
  },
  savedSearch: { name?: unknown; tags?: unknown } | undefined,
  dashboard: { name?: unknown; tags?: unknown; tiles?: unknown } | undefined,
): { name: string | null; tags: string[] } {
  const source = alert.source ?? AlertSource.SAVED_SEARCH;

  let name: string | null = null;
  let tags: string[] = [];
  if (source === AlertSource.TILE) {
    const dashboardName = normalizeName(dashboard?.name);
    if (dashboardName != null) {
      const rawTiles = dashboard?.tiles;
      const tiles: { id?: unknown; config?: { name?: unknown } | null }[] =
        Array.isArray(rawTiles) ? rawTiles : [];
      const tile =
        typeof alert.tileId === 'string'
          ? tiles.find(t => t?.id === alert.tileId)
          : undefined;
      name = `${dashboardName} ${normalizeName(tile?.config?.name) ?? 'Tile'}`;
    }
    tags = normalizeTags(dashboard?.tags);
  } else if (source === AlertSource.INLINE) {
    name = normalizeName(alert.chartConfig?.name);
  } else {
    name = normalizeName(savedSearch?.name);
    tags = normalizeTags(savedSearch?.tags);
  }

  return { name: name?.slice(0, ALERT_NAME_MAX_LENGTH) ?? null, tags };
}

const BACKFILL_BATCH_SIZE = 500;

const NAME_MISSING_FILTER = { name: { $in: [null, ''] } };
const TAGS_MISSING_FILTER = { $or: [{ tags: null }, { tags: { $size: 0 } }] };

export async function backfillAlertNameAndTags() {
  const ids = (
    await Alert.find(
      { $or: [NAME_MISSING_FILTER, ...TAGS_MISSING_FILTER.$or] },
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
      const hasTags = Array.isArray(alert.tags) && alert.tags.length > 0;

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
        ops.map(op => ({ updateOne: op })),
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
