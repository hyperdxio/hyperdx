// Port from ChartUtils + source.ts
import { add } from 'date-fns';

import type { SQLInterval } from '@/common/sqlTypes';

export const isBrowser: boolean =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

export const isNode: boolean =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

// If a user specifies a timestampValueExpression with multiple columns,
// this will return the first one. We'll want to refine this over time
export function getFirstTimestampValueExpression(valueExpression: string) {
  return valueExpression.split(',')[0].trim();
}

export enum Granularity {
  FifteenSecond = '15 second',
  ThirtySecond = '30 second',
  OneMinute = '1 minute',
  FiveMinute = '5 minute',
  TenMinute = '10 minute',
  FifteenMinute = '15 minute',
  ThirtyMinute = '30 minute',
  OneHour = '1 hour',
  TwoHour = '2 hour',
  SixHour = '6 hour',
  TwelveHour = '12 hour',
  OneDay = '1 day',
  TwoDay = '2 day',
  SevenDay = '7 day',
  ThirtyDay = '30 day',
}

export function hashCode(str: string) {
  let hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

export function convertDateRangeToGranularityString(
  dateRange: [Date, Date],
  maxNumBuckets: number,
): Granularity {
  const start = dateRange[0].getTime();
  const end = dateRange[1].getTime();
  const diffSeconds = Math.floor((end - start) / 1000);
  const granularitySizeSeconds = Math.ceil(diffSeconds / maxNumBuckets);

  if (granularitySizeSeconds <= 15) {
    return Granularity.FifteenSecond;
  } else if (granularitySizeSeconds <= 30) {
    return Granularity.ThirtySecond;
  } else if (granularitySizeSeconds <= 60) {
    return Granularity.OneMinute;
  } else if (granularitySizeSeconds <= 5 * 60) {
    return Granularity.FiveMinute;
  } else if (granularitySizeSeconds <= 10 * 60) {
    return Granularity.TenMinute;
  } else if (granularitySizeSeconds <= 15 * 60) {
    return Granularity.FifteenMinute;
  } else if (granularitySizeSeconds <= 30 * 60) {
    return Granularity.ThirtyMinute;
  } else if (granularitySizeSeconds <= 3600) {
    return Granularity.OneHour;
  } else if (granularitySizeSeconds <= 2 * 3600) {
    return Granularity.TwoHour;
  } else if (granularitySizeSeconds <= 6 * 3600) {
    return Granularity.SixHour;
  } else if (granularitySizeSeconds <= 12 * 3600) {
    return Granularity.TwelveHour;
  } else if (granularitySizeSeconds <= 24 * 3600) {
    return Granularity.OneDay;
  } else if (granularitySizeSeconds <= 2 * 24 * 3600) {
    return Granularity.TwoDay;
  } else if (granularitySizeSeconds <= 7 * 24 * 3600) {
    return Granularity.SevenDay;
  } else if (granularitySizeSeconds <= 30 * 24 * 3600) {
    return Granularity.ThirtyDay;
  }

  return Granularity.ThirtyDay;
}

export function convertGranularityToSeconds(granularity: SQLInterval): number {
  const [num, unit] = granularity.split(' ');
  const numInt = Number.parseInt(num);
  switch (unit) {
    case 'second':
      return numInt;
    case 'minute':
      return numInt * 60;
    case 'hour':
      return numInt * 60 * 60;
    case 'day':
      return numInt * 60 * 60 * 24;
    default:
      return 0;
  }
}
// Note: roundToNearestMinutes is broken in date-fns currently
// additionally it doesn't support seconds or > 30min
// so we need to write our own :(
// see: https://github.com/date-fns/date-fns/pull/3267/files
export function toStartOfInterval(date: Date, granularity: SQLInterval): Date {
  const [num, unit] = granularity.split(' ');
  const numInt = Number.parseInt(num);
  const roundFn = Math.floor;

  switch (unit) {
    case 'second':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          date.getUTCMinutes(),
          roundFn(date.getUTCSeconds() / numInt) * numInt,
        ),
      );
    case 'minute':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          roundFn(date.getUTCMinutes() / numInt) * numInt,
        ),
      );
    case 'hour':
      return new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          roundFn(date.getUTCHours() / numInt) * numInt,
        ),
      );
    case 'day': {
      // Clickhouse uses the # of days since unix epoch to round dates
      // see: https://github.com/ClickHouse/ClickHouse/blob/master/src/Common/DateLUTImpl.h#L1059
      const daysSinceEpoch = date.getTime() / 1000 / 60 / 60 / 24;
      const daysSinceEpochRounded = roundFn(daysSinceEpoch / numInt) * numInt;

      return new Date(daysSinceEpochRounded * 1000 * 60 * 60 * 24);
    }
    default:
      return date;
  }
}

export function timeBucketByGranularity(
  start: Date,
  end: Date,
  granularity: SQLInterval,
): Date[] {
  const buckets: Date[] = [];

  let current = toStartOfInterval(start, granularity);
  const granularitySeconds = convertGranularityToSeconds(granularity);
  while (current < end) {
    buckets.push(current);
    current = add(current, {
      seconds: granularitySeconds,
    });
  }

  return buckets;
}