import { Granularity } from '@hyperdx/common-utils/dist/utils';

export type JSONBlob = Record<string, Json>;

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export const useTry = <T>(fn: () => T): [null | Error | unknown, null | T] => {
  let output: null | T = null;
  let error: null | Error | unknown = null;
  try {
    output = fn();
    return [error, output];
  } catch (e) {
    error = e;
    return [error, output];
  }
};

export const tryJSONStringify = (json: Json) => {
  const [_, result] = useTry<string>(() => JSON.stringify(json));
  return result;
};

export const truncateString = (str: string, length: number) => {
  if (str.length > length) {
    return str.substring(0, length) + '...';
  }
  return str;
};

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

export const convertMsToGranularityString = (ms: number): Granularity => {
  const granularitySizeSeconds = Math.ceil(ms / 1000);

  if (granularitySizeSeconds <= 30) {
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
};
