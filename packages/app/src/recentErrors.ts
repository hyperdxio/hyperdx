// Recent query/mutation failures, surfaced in the "Copy debug info" report.
// Only the error itself is recorded: query keys and SQL carry customer data.

export type RecentError = {
  at: string;
  route: string;
  name: string;
  status?: number;
  code?: number;
  endpoint?: string;
  message: string;
  count: number;
};

const MAX_ERRORS = 20;
const MAX_MESSAGE_LENGTH = 300;

// ClickHouse quotes the failing query in its messages, filter values included.
const QUERY_FRAGMENT =
  /(\s*In scope |\s*while processing query|\s*\(in query:|\s*failed at position).*$/is;

function scrubMessage(message: string): string {
  return message.replace(QUERY_FRAGMENT, '').replace(/'[^']*'/g, "'?'");
}

let errors: RecentError[] = [];

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null
    ? Reflect.get(obj, key)
    : undefined;
}

// ky's message only restates the status, so name the endpoint that failed.
function endpointOf(err: Error): string | undefined {
  const request = field(err, 'request');
  const url = field(request, 'url');
  if (typeof url !== 'string') return undefined;
  try {
    return `${String(field(request, 'method') ?? 'GET')} ${new URL(url).pathname}`;
  } catch {
    return undefined;
  }
}

export function recordRecentError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const status = field(field(err, 'response'), 'status');
  // The ClickHouse client puts the code on the wrapped error's cause.
  const causeCode = field(err.cause, 'code');
  const code = Number(causeCode ?? err.message.match(/Code: (\d+)\./)?.[1]);
  const isClickHouse =
    err.name === 'ClickHouseQueryError' ||
    causeCode != null ||
    /Code: \d+\.|DB::Exception/.test(err.message);
  const message = (
    isClickHouse ? scrubMessage(err.message) : err.message
  ).slice(0, MAX_MESSAGE_LENGTH);
  const endpoint = endpointOf(err);
  const route = typeof window !== 'undefined' ? window.location.pathname : '';

  // A refreshing dashboard repeats the same failure; keep one entry so it
  // cannot push the other errors out of the buffer.
  const previous = errors.find(
    e =>
      e.route === route &&
      e.name === err.name &&
      e.status === status &&
      e.endpoint === endpoint &&
      e.message === message,
  );
  errors = errors.filter(e => e !== previous);
  errors.push({
    // Not a render path: each error needs its own timestamp.
    // eslint-disable-next-line no-restricted-syntax
    at: new Date().toISOString(),
    route,
    name: err.name,
    ...(typeof status === 'number' ? { status } : {}),
    ...(Number.isInteger(code) ? { code } : {}),
    ...(endpoint ? { endpoint } : {}),
    message,
    count: (previous?.count ?? 0) + 1,
  });
  if (errors.length > MAX_ERRORS) errors = errors.slice(-MAX_ERRORS);
}

export function getRecentErrors(): RecentError[] {
  return [...errors];
}

export function clearRecentErrors(): void {
  errors = [];
}
