import { set } from 'lodash';

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
