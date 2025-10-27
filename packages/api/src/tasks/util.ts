import { set } from 'lodash';

import logger from '@/utils/logger';

// transfer keys of attributes with dot into nested object
// ex: { 'a.b': 'c', 'd.e.f': 'g' } -> { a: { b: 'c' }, d: { e: { f: 'g' } } }
export const unflattenObject = (
  obj: Record<string, string>,
  separator = '.',
  maxDepth = 10,
) => {
  const result: Record<string, any> = Object.create(null);
  Object.entries(obj).forEach(([key, value]) => {
    const keys = key.split(separator);
    if (keys.some(k => k.length == 0)) {
      throw new Error(`Invalid key format: ${key} contains empty level`);
    }

    const path = keys.length <= maxDepth ? keys : keys.slice(0, maxDepth);
    const finalValue = keys.length <= maxDepth ? value : {};

    set(result, path, finalValue);
  });

  return result;
};

// Round down a date to the nearest interval
export const roundDownTo = (roundTo: number) => (x: Date) => {
  if (roundTo <= 0) {
    throw new Error('roundTo must be greater than zero');
  }
  return new Date(Math.floor(x.getTime() / roundTo) * roundTo);
};

// Round down a date to the nearest X minutes
export const roundDownToXMinutes = (x: number) => roundDownTo(1000 * 60 * x);

// Escape a string for JSON representation by wrapping in quotes and escaping special characters
export const escapeJsonString = (str: string) => {
  return JSON.stringify(str).slice(1, -1);
};

const MAX_NUM_WINDOWS = 50;
const maxLookbackTime = (windowSizeInMins: number) =>
  3600_000 * (windowSizeInMins < 15 ? 6 : 24);
export function calcAlertDateRange(
  _startTime: number,
  _endTime: number,
  windowSizeInMins: number,
): [Date, Date] {
  let startTime = _startTime;
  const endTime = _endTime;
  const numWindows = (endTime - startTime) / 60_000 / windowSizeInMins;
  // Truncate if too many windows are present
  if (numWindows > MAX_NUM_WINDOWS) {
    startTime = endTime - MAX_NUM_WINDOWS * 1000 * 60 * windowSizeInMins;
    logger.info(
      {
        requestedStartTime: _startTime,
        startTime,
        endTime,
        windowSizeInMins,
        numWindows,
      },
      'startTime truncated due to too many windows',
    );
  }
  // Truncate if time range is over threshold
  const MAX_LOOKBACK_TIME = maxLookbackTime(windowSizeInMins);
  if (endTime - startTime > MAX_LOOKBACK_TIME) {
    startTime = endTime - MAX_LOOKBACK_TIME;
    logger.info(
      {
        requestedStartTime: _startTime,
        startTime,
        endTime,
        windowSizeInMins,
        numWindows,
      },
      'startTime truncated due to long lookback time',
    );
  }
  return [new Date(startTime), new Date(endTime)];
}
