import { sub } from 'date-fns';
import _ from 'lodash';

import { Granularity } from '@/ChartUtils';
import { Alert } from '@/commonTypes';
import { AlertChannelType, AlertInterval } from '@/types';

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

export function intervalToDateRange(interval: AlertInterval): [Date, Date] {
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

export const ALERT_THRESHOLD_TYPE_OPTIONS: Record<string, string> = {
  above: 'At least (≥)',
  below: 'Below (<)',
};

export const TILE_ALERT_THRESHOLD_TYPE_OPTIONS: Record<string, string> = {
  above: 'is at least (≥)',
  below: 'falls below (<)',
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
  // Exclude 1m
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

export const DEFAULT_TILE_ALERT: Alert = {
  threshold: 1,
  thresholdType: 'above',
  interval: '5m',
  channel: {
    type: 'webhook',
    webhookId: '',
  },
};