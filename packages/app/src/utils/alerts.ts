import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  sub,
} from 'date-fns';
import _ from 'lodash';
import { z } from 'zod';
import { formatTileAlertDisplayName } from '@hyperdx/common-utils/dist/alerts';
import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  ALERT_INTERVAL_TO_MINUTES,
  AlertChannelType,
  AlertInterval,
  AlertSource,
  AlertThresholdType,
  ChartAlertBaseSchema,
} from '@hyperdx/common-utils/dist/types';

import { IS_DEV } from '@/config';
import type { AlertsPageItem } from '@/types';

export function intervalToGranularity(interval: AlertInterval) {
  if (interval === '1m') return Granularity.OneMinute;
  if (interval === '5m') return Granularity.FiveMinute;
  if (interval === '15m') return Granularity.FifteenMinute;
  if (interval === '30m') return Granularity.ThirtyMinute;
  if (interval === '1h') return Granularity.OneHour;
  if (interval === '6h') return Granularity.SixHour;
  if (interval === '12h') return Granularity.TwelveHour;
  if (interval === '1d') return Granularity.OneDay;
  return Granularity.OneDay;
}

export function intervalToMinutes(interval: AlertInterval): number {
  return ALERT_INTERVAL_TO_MINUTES[interval];
}

export function intervalToDateRange(interval: AlertInterval): [Date, Date] {
  // eslint-disable-next-line no-restricted-syntax
  const now = new Date();
  if (interval === '1m') return [sub(now, { minutes: 15 }), now];
  if (interval === '5m') return [sub(now, { hours: 1 }), now];
  if (interval === '15m') return [sub(now, { hours: 4 }), now];
  if (interval === '30m') return [sub(now, { hours: 8 }), now];
  if (interval === '1h') return [sub(now, { hours: 16 }), now];
  if (interval === '6h') return [sub(now, { days: 4 }), now];
  if (interval === '12h') return [sub(now, { days: 7 }), now];
  if (interval === '1d') return [sub(now, { days: 7 }), now];
  return [now, now];
}

export function extendDateRangeToInterval(
  dateRange: [Date, Date],
  interval: AlertInterval,
): [Date, Date] {
  const [start, end] = dateRange;

  if (interval === '1m' && differenceInMinutes(end, start) < 15) {
    return [sub(end, { minutes: 15 }), end];
  }
  if (interval === '5m' && differenceInHours(end, start) < 1) {
    return [sub(end, { hours: 1 }), end];
  }
  if (interval === '15m' && differenceInHours(end, start) < 4) {
    return [sub(end, { hours: 4 }), end];
  }
  if (interval === '30m' && differenceInHours(end, start) < 8) {
    return [sub(end, { hours: 8 }), end];
  }
  if (interval === '1h' && differenceInHours(end, start) < 16) {
    return [sub(end, { hours: 16 }), end];
  }
  if (interval === '6h' && differenceInDays(end, start) < 4) {
    return [sub(end, { days: 4 }), end];
  }
  if (interval === '12h' && differenceInDays(end, start) < 7) {
    return [sub(end, { days: 7 }), end];
  }
  if (interval === '1d' && differenceInDays(end, start) < 7) {
    return [sub(end, { days: 7 }), end];
  }
  return dateRange;
}

export const ALERT_THRESHOLD_TYPE_OPTIONS: Record<string, string> = {
  above: 'At least (≥)',
  below: 'Below (<)',
  above_exclusive: 'Above (>)',
  below_or_equal: 'At most (≤)',
  equal: 'Equal to (=)',
  not_equal: 'Not equal to (≠)',
  between: 'Between (≤ x ≤)',
  not_between: 'Outside (< or >)',
};

export const TILE_ALERT_THRESHOLD_TYPE_OPTIONS: Record<string, string> = {
  above: 'is at least (≥)',
  below: 'falls below (<)',
  above_exclusive: 'is above (>)',
  below_or_equal: 'is at most (≤)',
  equal: 'equals (=)',
  not_equal: 'does not equal (≠)',
  between: 'is between (≤ x ≤)',
  not_between: 'is outside (< or >)',
};

export const ALERT_INTERVAL_OPTIONS: Record<AlertInterval, string> = {
  '1m': '1 minute',
  '5m': '5 minute',
  '15m': '15 minute',
  '30m': '30 minute',
  '1h': '1 hour',
  '6h': '6 hour',
  '12h': '12 hour',
  '1d': '1 day',
};

export const TILE_ALERT_INTERVAL_OPTIONS = _.pick(ALERT_INTERVAL_OPTIONS, [
  ...(IS_DEV ? (['1m'] as const) : []),
  '5m',
  '15m',
  '30m',
  '1h',
  '6h',
  '12h',
  '1d',
]);

export const ALERT_CHANNEL_OPTIONS: Record<AlertChannelType, string> = {
  webhook: 'Webhook',
};

const EMPTY_ALERT_CHANNEL = { type: 'webhook', webhookId: '' } as const;

/**
 * Form value for an alert's notification channels. Alerts saved before
 * multi-channel support only carry the singular `channel`, and the form always
 * needs at least one row to render.
 *
 * A downstream fork defines channel types this repo doesn't (e.g. email).
 * Channels are copied through untouched rather than rebuilt field-by-field,
 * so saving an alert here never destroys fields this repo doesn't know about.
 */
export function toAlertChannels<T extends { type?: string | null }>(alert?: {
  channel?: T | null;
  channels?: T[] | null;
}): T[] | [typeof EMPTY_ALERT_CHANNEL] {
  const source = alert?.channels?.length
    ? alert.channels
    : alert?.channel != null && alert.channel.type != null
      ? [alert.channel]
      : [];
  return source.length > 0 ? source : [{ ...EMPTY_ALERT_CHANNEL }];
}

export const DEFAULT_TILE_ALERT: z.infer<typeof ChartAlertBaseSchema> = {
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
  interval: '5m',
  scheduleOffsetMinutes: 0,
  scheduleStartAt: null,
  channels: [{ ...EMPTY_ALERT_CHANNEL }],
  note: null,
};

/**
 * Checks if an alert's silence period has expired.
 * @param silenced - The alert's silenced state containing the until timestamp
 * @returns true if the silence period has expired, false otherwise
 */
export function isAlertSilenceExpired(silenced?: {
  until: string | Date;
}): boolean {
  // eslint-disable-next-line no-restricted-syntax
  return silenced ? new Date() > new Date(silenced.until) : false;
}

export function parseScheduleStartAtValue(
  value: string | null | undefined,
): Date | null {
  if (value == null) {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

type AlertScheduleFields = {
  scheduleOffsetMinutes?: number;
  scheduleStartAt?: string | null;
};

type NormalizeAlertScheduleOptions = {
  preserveExplicitScheduleOffsetMinutes?: boolean;
  preserveExplicitScheduleStartAt?: boolean;
};

/**
 * Keep alert documents backward-compatible by avoiding no-op writes for
 * scheduling fields on pre-migration alerts that never had these keys.
 */
export function normalizeNoOpAlertScheduleFields<
  T extends AlertScheduleFields | undefined,
>(
  alert: T,
  previousAlert?: AlertScheduleFields | null,
  options: NormalizeAlertScheduleOptions = {},
): T {
  if (alert == null) {
    return alert;
  }

  const normalizedAlert = { ...alert };
  // Treat undefined as "field absent" so we don't depend on object key
  // preservation/stripping behavior from any parsing layer.
  const previousHadOffset =
    previousAlert != null && previousAlert.scheduleOffsetMinutes !== undefined;
  const previousHadStartAt =
    previousAlert != null && previousAlert.scheduleStartAt !== undefined;

  if (
    (normalizedAlert.scheduleOffsetMinutes ?? 0) === 0 &&
    !previousHadOffset &&
    !options.preserveExplicitScheduleOffsetMinutes
  ) {
    delete normalizedAlert.scheduleOffsetMinutes;
  }

  if (
    normalizedAlert.scheduleStartAt == null &&
    !previousHadStartAt &&
    !options.preserveExplicitScheduleStartAt
  ) {
    delete normalizedAlert.scheduleStartAt;
  }

  return normalizedAlert as T;
}

/**
 * Human label for what an alert watches. Shared by the row's source icon
 * tooltip, the alerts-page source filter, and free-text search, so all three
 * agree on the wording a user sees and types.
 */
export function getAlertSourceLabel(alert: {
  source?: AlertSource | null;
}): string {
  switch (alert.source) {
    case AlertSource.TILE:
      return 'Dashboard tile';
    case AlertSource.SAVED_SEARCH:
      return 'Saved search';
    default:
      return 'Unknown source';
  }
}

/**
 * The name the server would derive if the alert had none of its own. Only for
 * previewing (e.g. the name input's placeholder);
 */
export function getDerivedAlertDisplayName(
  alert: AlertsPageItem,
): string | undefined {
  if (alert.source === AlertSource.TILE && alert.dashboard) {
    const tile = alert.dashboard.tiles.find(t => t.id === alert.tileId);
    return formatTileAlertDisplayName(alert.dashboard.name, tile?.config.name);
  }
  if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
    return alert.savedSearch.name;
  }
  return undefined;
}

/** URL of the saved search / dashboard tile the alert is watching. */
export function getAlertSourceUrl(alert: AlertsPageItem): string {
  if (alert.source === AlertSource.TILE && alert.dashboard) {
    return `/dashboards/${alert.dashboardId}?highlightedTileId=${alert.tileId}`;
  }
  if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
    return `/search/${alert.savedSearchId}`;
  }
  return '';
}

export function getAlertCreatorLabel(
  alert: AlertsPageItem,
): string | undefined {
  if (!alert.createdBy) return undefined;
  return alert.createdBy.name || alert.createdBy.email;
}
