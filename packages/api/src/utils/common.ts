export const useTry = <T>(fn: () => T): [null | Error | unknown, null | T] => {
  let output: T | null = null;
  let error: any = null;
  try {
    output = fn();
    return [error, output];
  } catch (e) {
    error = e;
    return [error, output];
  }
};

export const tryJSONStringify = (
  json: Record<string, unknown> | Record<string, unknown>[],
) => {
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
