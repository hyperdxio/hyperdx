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
