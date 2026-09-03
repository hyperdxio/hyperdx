import {
  displayTypeSupportsBuilderAlerts,
  displayTypeSupportsRawSqlAlerts,
  isFormulaSourceKind,
  validateRawSqlForAlert,
} from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import { isRangeThresholdType } from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { Types } from 'mongoose';
import { z } from 'zod';

import type { ObjectId } from '@/models';
import Alert, {
  AlertChannel,
  AlertSource,
  getAlertChannels,
  IAlert,
} from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard, { IDashboard } from '@/models/dashboard';
import { ISavedSearch, SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import { IUser } from '@/models/user';
import Webhook from '@/models/webhook';
import { Api400Error } from '@/utils/errors';
import { internalAlertSchema, objectIdSchema } from '@/utils/zod';

export type AlertInput = Omit<
  IAlert,
  | 'id'
  | 'channel'
  | 'scheduleStartAt'
  | 'savedSearchId'
  | 'createdAt'
  | 'createdBy'
  | 'updatedAt'
  | 'team'
  | 'state'
> & {
  id?: string;
  // Exactly one of channel/channels is provided (enforced by alertSchema);
  // `channels` flows in optionally via IAlert.
  channel?: AlertChannel;
  // Replace the Date-type fields from IAlert
  scheduleStartAt?: string | null;
  // Replace the ObjectId-type fields from IAlert
  savedSearchId?: string;
  dashboardId?: string;
};

const validateObjectId = (id: string | undefined, message: string) => {
  if (objectIdSchema.safeParse(id).success === false) {
    throw new Api400Error(message);
  }
};

export const validateAlertInput = async (
  teamId: ObjectId,
  alertInput: Pick<
    AlertInput,
    | 'source'
    | 'dashboardId'
    | 'tileId'
    | 'savedSearchId'
    | 'chartConfig'
    | 'channel'
    | 'channels'
  >,
) => {
  if (alertInput.source === AlertSource.TILE) {
    validateObjectId(alertInput.dashboardId, 'Invalid dashboard ID');

    const dashboard = await Dashboard.findOne({
      _id: alertInput.dashboardId,
      team: teamId,
    });

    if (dashboard == null) {
      throw new Api400Error('Dashboard not found');
    }

    const tile = dashboard.tiles.find(tile => tile.id === alertInput.tileId);

    if (tile == null) {
      throw new Api400Error('Tile not found');
    }

    if (tile.config != null && isRawSqlSavedChartConfig(tile.config)) {
      if (!displayTypeSupportsRawSqlAlerts(tile.config.displayType)) {
        throw new Api400Error(
          'Alerts on Raw SQL tiles are only supported for Line, Stacked Bar, or Number display types',
        );
      }

      const { errors } = validateRawSqlForAlert(tile.config);
      if (errors.length > 0) {
        throw new Api400Error(
          `Raw SQL alert query is invalid: ${errors.join(', ')}`,
        );
      }
    }
  }

  if (alertInput.source === AlertSource.SAVED_SEARCH) {
    validateObjectId(alertInput.savedSearchId, 'Invalid saved search ID');

    const savedSearch = await SavedSearch.findOne({
      _id: alertInput.savedSearchId,
      team: teamId,
    });

    if (savedSearch == null) {
      throw new Api400Error('Saved search not found');
    }
  }

  if (alertInput.source === AlertSource.INLINE) {
    const chartConfig = alertInput.chartConfig;
    if (chartConfig == null) {
      throw new Api400Error('Chart config is required');
    }

    if (isRawSqlSavedChartConfig(chartConfig)) {
      if (!displayTypeSupportsRawSqlAlerts(chartConfig.displayType)) {
        throw new Api400Error(
          'Alerts on Raw SQL charts are only supported for Line, Stacked Bar, or Number display types',
        );
      }

      const { errors } = validateRawSqlForAlert(chartConfig);
      if (errors.length > 0) {
        throw new Api400Error(
          `Raw SQL alert query is invalid: ${errors.join(', ')}`,
        );
      }

      // Raw SQL configs carry the connection directly; the source reference
      // is optional metadata for macro expansion ($__sourceTable).
      validateObjectId(chartConfig.connection, 'Invalid connection ID');
      const connection = await Connection.findOne({
        _id: chartConfig.connection,
        team: teamId,
      });
      if (connection == null) {
        throw new Api400Error('Connection not found');
      }
      if (chartConfig.source) {
        validateObjectId(chartConfig.source, 'Invalid source ID');
        const source = await Source.findOne({
          _id: chartConfig.source,
          team: teamId,
        });
        if (source == null) {
          throw new Api400Error('Source not found');
        }
        // The worker executes the query through chartConfig.connection while
        // expanding $__sourceTable/metricTables from this source. Accepting a
        // source on a different (even team-owned) connection would query the
        // wrong database — silently wrong values when the table also exists
        // there, repeated query failures when it does not.
        //
        // Compare as ObjectIds, not strings: objectIdSchema admits every
        // representation ObjectId.isValid does (uppercase hex, 12-byte
        // strings), and the Mongo lookups above cast them — a lexical
        // comparison would reject an equivalent non-canonical ID.
        if (
          !new Types.ObjectId(String(source.connection)).equals(
            chartConfig.connection,
          )
        ) {
          throw new Api400Error(
            'Source does not belong to the specified connection',
          );
        }
      }
    } else {
      // Builder configs: same display types the alert task can evaluate as a
      // time series (mirrors the tile-alert rules).
      if (!displayTypeSupportsBuilderAlerts(chartConfig.displayType)) {
        throw new Api400Error(
          'Inline chart alerts are only supported for Line, Stacked Bar, or Number display types',
        );
      }

      validateObjectId(chartConfig.source, 'Invalid source ID');
      const source = await Source.findOne({
        _id: chartConfig.source,
        team: teamId,
      });
      if (source == null) {
        throw new Api400Error('Source not found');
      }

      // Same formula source-kind gate as dashboard tiles ("Add Formula" is
      // disabled in the editor for these kinds), so the API cannot persist a
      // config the editor refuses.
      if (
        'formulas' in chartConfig &&
        (chartConfig.formulas?.length ?? 0) > 0 &&
        !isFormulaSourceKind(source.kind)
      ) {
        throw new Api400Error(
          'Alerts with formulas require a Metric, Log, or Trace source',
        );
      }
    }
  }

  const channels = getAlertChannels(alertInput);
  if (channels.length === 0) {
    throw new Api400Error('At least one notification channel is required');
  }

  const webhookIds = channels
    .filter(c => c.type === 'webhook')
    .map(c => c.webhookId);
  for (const webhookId of webhookIds) {
    validateObjectId(webhookId, 'Invalid webhook ID');
  }
  const uniqueIds = [...new Set(webhookIds)];
  const found = await Webhook.countDocuments({
    _id: { $in: uniqueIds },
    team: teamId,
  });
  if (found !== uniqueIds.length) {
    throw new Api400Error('Webhook not found');
  }
};

// Exported for unit testing the channel-mirroring invariant (see
// controllers/__tests__/alerts.test.ts) -- otherwise only used internally.
export const makeAlert = (
  alert: AlertInput,
  userId?: ObjectId,
): Partial<IAlert> => {
  // Preserve existing DB value when scheduleStartAt is omitted from updates
  // (undefined), while still allowing explicit clears via null.
  const hasScheduleStartAt = alert.scheduleStartAt !== undefined;
  // If scheduleStartAt is explicitly provided, offset-based alignment is ignored.
  // Force persisted offset to 0 so updates can't leave stale non-zero offsets.
  // If scheduleStartAt is explicitly cleared and offset is omitted, also reset
  // to 0 to avoid preserving stale values from older documents.
  const normalizedScheduleOffsetMinutes =
    hasScheduleStartAt && alert.scheduleStartAt != null
      ? 0
      : hasScheduleStartAt && alert.scheduleOffsetMinutes == null
        ? 0
        : alert.scheduleOffsetMinutes;
  const isSavedSearch = alert.source === AlertSource.SAVED_SEARCH;
  const isTile = alert.source === AlertSource.TILE;
  const isInline = alert.source === AlertSource.INLINE;
  const channels = getAlertChannels(alert);

  return {
    // `channels` is canonical; `channel` mirrors channels[0] so readers that
    // predate multi-channel support (older task runners mid-rollout) still
    // notify the first target.
    channel: channels[0] ?? { type: null },
    channels,
    interval: alert.interval,
    ...(normalizedScheduleOffsetMinutes != null && {
      scheduleOffsetMinutes: normalizedScheduleOffsetMinutes,
    }),
    ...(hasScheduleStartAt && {
      scheduleStartAt:
        alert.scheduleStartAt == null ? null : new Date(alert.scheduleStartAt),
    }),
    source: alert.source,
    threshold: alert.threshold,
    // Omitted rather than set to undefined for a non-range comparator, so
    // updateAlert can $unset the path. Writing null instead would surface on
    // the create/update responses, which return the document directly, and a
    // client round-tripping one back into an update would fail validation.
    ...(isRangeThresholdType(alert.thresholdType) && {
      thresholdMax: alert.thresholdMax,
    }),
    thresholdType: alert.thresholdType,
    ...(userId && { createdBy: userId }),

    // Message template
    // Coerce undefined to null so Mongoose clears the field on update.
    // https://mongoosejs.com/docs/migrating_to_6.html#removed-omitundefined
    name: alert.name ?? null,
    message: alert.message ?? null,
    note: alert.note ?? null,

    // Log alerts
    savedSearch: isSavedSearch
      ? ((alert.savedSearchId ?? null) as unknown as ObjectId)
      : null,
    groupBy: isSavedSearch ? (alert.groupBy ?? null) : null,
    // Tile alerts
    dashboard: isTile
      ? ((alert.dashboardId ?? null) as unknown as ObjectId)
      : null,
    tileId: isTile ? (alert.tileId ?? null) : null,

    // Inline alerts
    chartConfig: isInline ? (alert.chartConfig ?? null) : null,

    // Multi-window alerting
    numConsecutiveWindows: alert.numConsecutiveWindows ?? null,
  };
};

// makeAlert omits thresholdMax for a non-range comparator, and Mongoose drops
// an omitted key from an update rather than clearing the path, so the bound has
// to be unset explicitly or an alert edited off `between` keeps a stale one and
// reports a range condition it no longer has. Every update path needs this;
// $unset is ignored on an upsert insert, so it is safe there too.
const makeAlertUpdate = (alertInput: AlertInput, userId?: ObjectId) => ({
  $set: makeAlert(alertInput, userId),
  ...(!isRangeThresholdType(alertInput.thresholdType) && {
    $unset: { thresholdMax: 1 },
  }),
});

export const createAlert = async (
  teamId: ObjectId,
  alertInput: z.infer<typeof internalAlertSchema>,
  userId: ObjectId,
) => {
  return new Alert({
    ...makeAlert(alertInput, userId),
    team: teamId,
  }).save();
};

// create an update alert function based off of the above create alert function
export const updateAlert = async (
  id: string,
  teamId: ObjectId,
  alertInput: AlertInput,
) => {
  // should consider clearing AlertHistory when updating an alert?
  return Alert.findOneAndUpdate(
    {
      _id: id,
      team: teamId,
    },
    makeAlertUpdate(alertInput),
    {
      returnDocument: 'after',
    },
  );
};

export const getAlerts = async (
  teamId: ObjectId,
  { limit, offset }: { limit: number; offset: number },
) => {
  // Sort by _id so skip/offset paging is stable across requests (MongoDB does
  // not guarantee natural order between separate find() calls).
  return Alert.find({ team: teamId })
    .sort({ _id: 1 })
    .skip(offset)
    .limit(limit);
};

export const countAlerts = async (teamId: ObjectId) => {
  return Alert.countDocuments({ team: teamId });
};

export const getAlertById = async (
  alertId: ObjectId | string,
  teamId: ObjectId | string,
) => {
  return Alert.findOne({
    _id: alertId,
    team: teamId,
  });
};

export const getTeamDashboardAlertsByDashboardAndTile = async (
  teamId: ObjectId,
) => {
  const alerts = await Alert.find({
    source: AlertSource.TILE,
    team: teamId,
  }).populate('createdBy', 'email name');
  return groupBy(alerts, a => `${a.dashboard?.toString()}:${a.tileId}`);
};

export const getDashboardAlertsByTile = async (
  teamId: ObjectId,
  dashboardId: ObjectId | string,
) => {
  const alerts = await Alert.find({
    dashboard: dashboardId,
    source: AlertSource.TILE,
    team: teamId,
  }).populate('createdBy', 'email name');
  return groupBy(alerts, 'tileId');
};

export const createOrUpdateDashboardAlerts = async (
  dashboardId: ObjectId | string,
  teamId: ObjectId,
  alertsByTile: Record<string, AlertInput>,
  userId?: ObjectId,
) => {
  return Promise.all(
    Object.entries(alertsByTile).map(async ([tileId, alert]) => {
      const filter = {
        dashboard: dashboardId,
        tileId,
        source: AlertSource.TILE,
        team: teamId,
      };
      const alertInput = {
        ...alert,
        source: AlertSource.TILE,
        dashboardId: dashboardId.toString(),
        tileId,
      };
      const oldAlert = await Alert.findOne(filter);
      const alertUpdate =
        oldAlert && oldAlert.createdBy
          ? makeAlertUpdate(alertInput)
          : makeAlertUpdate(alertInput, userId);

      return await Alert.findOneAndUpdate(filter, alertUpdate, {
        new: true,
        upsert: true,
      });
    }),
  );
};

export const deleteDashboardAlerts = async (
  dashboardId: ObjectId | string,
  teamId: ObjectId,
  tileIds?: string[],
) => {
  return Alert.deleteMany({
    dashboard: dashboardId,
    team: teamId,
    source: AlertSource.TILE,
    ...(tileIds && { tileId: { $in: tileIds } }),
  });
};

export const deleteSavedSearchAlerts = async (
  savedSearchId: string,
  teamId: string,
) => {
  return Alert.deleteMany({
    savedSearch: savedSearchId,
    team: teamId,
  });
};

export const getAlertsEnhanced = async (teamId: ObjectId) => {
  return Alert.find({ team: teamId }).populate<{
    savedSearch: ISavedSearch;
    dashboard: IDashboard;
    createdBy?: IUser;
    silenced?: IAlert['silenced'] & {
      by: IUser;
    };
  }>(['savedSearch', 'dashboard', 'createdBy', 'silenced.by']);
};

export const getAlertEnhanced = async (
  alertId: ObjectId | string,
  teamId: ObjectId,
) => {
  return Alert.findOne({ _id: alertId, team: teamId }).populate<{
    savedSearch: ISavedSearch;
    dashboard: IDashboard;
    createdBy?: IUser;
    silenced?: IAlert['silenced'] & {
      by: IUser;
    };
  }>(['savedSearch', 'dashboard', 'createdBy', 'silenced.by']);
};

export const deleteAlert = async (id: string, teamId: ObjectId) => {
  return Alert.deleteOne({
    _id: id,
    team: teamId,
  });
};
