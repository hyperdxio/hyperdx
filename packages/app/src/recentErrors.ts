import { getApiErrorMessage } from '@/utils/apiErrors';

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
  // The API's own explanation, read from the response body after the fact.
  reason?: string;
  count: number;
};

const MAX_ERRORS = 20;
const MAX_MESSAGE_LENGTH = 300;

// ClickHouse quotes the failing query in its messages, filter values included.
const QUERY_FRAGMENT =
  /(\s*In scope |\s*:?\s*while processing\b|\s*\(in query:|\s*failed at position).*$/is;

// Quoted identifiers such as a missing column stay: they are what a ticket
// needs. Only values compared in what is left of the message are blanked.
const COMPARED_VALUE = /((?:[=<>]|\b(?:LIKE|IN)\b)\s*\(?\s*)'[^']*'/gi;

function scrubMessage(message: string): string {
  return message.replace(QUERY_FRAGMENT, '').replace(COMPARED_VALUE, "$1'?'");
}

// The report is one line per error.
const oneLine = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);

let errors: RecentError[] = [];
// API failures waiting for their reason; kept apart so a burst of them cannot
// push other errors out before they fold together.
let pending: RecentError[] = [];

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null
    ? Reflect.get(obj, key)
    : undefined;
}

// Names the request that failed; pathname only, so tokens stay out.
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

type Cloneable = { clone(): unknown };
const isCloneable = (value: unknown): value is Cloneable =>
  typeof field(value, 'clone') === 'function';

const sameFailure = (a: RecentError, b: RecentError) =>
  a.route === b.route &&
  a.name === b.name &&
  a.status === b.status &&
  a.endpoint === b.endpoint &&
  a.message === b.message &&
  a.reason === b.reason;

// A refreshing dashboard repeats the same failure; fold it into the earlier
// entry so it cannot push the other errors out of the buffer.
function add(entry: RecentError): void {
  const previous = errors.find(e => e !== entry && sameFailure(e, entry));
  if (previous) entry.count += previous.count;
  errors = errors.filter(e => e !== previous && e !== entry);
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors = errors.slice(-MAX_ERRORS);
}

export function recordRecentError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const response = field(err, 'response');
  const status = field(response, 'status');
  // The ClickHouse client puts the code on the wrapped error's cause.
  const causeCode = field(err.cause, 'code');
  const code = Number(causeCode ?? err.message.match(/Code: (\d+)\./)?.[1]);
  const isClickHouse =
    err.name === 'ClickHouseQueryError' ||
    causeCode != null ||
    /Code: \d+\.|DB::Exception/.test(err.message);
  const endpoint = endpointOf(err);

  const entry: RecentError = {
    // Not a render path: each error needs its own timestamp.
    // eslint-disable-next-line no-restricted-syntax
    at: new Date().toISOString(),
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    name: err.name,
    ...(typeof status === 'number' ? { status } : {}),
    ...(Number.isInteger(code) ? { code } : {}),
    ...(endpoint ? { endpoint } : {}),
    message: oneLine(isClickHouse ? scrubMessage(err.message) : err.message),
    count: 1,
  };

  // ky's message only restates the status; the API's reason is in the body.
  // Reading a clone leaves the original for the caller's own error handling,
  // and the entry is only compared with others once its reason is known.
  if (!isCloneable(response)) {
    add(entry);
    return;
  }
  let clone: unknown;
  try {
    clone = response.clone();
  } catch {
    add(entry); // body already read: no reason to wait for
    return;
  }
  pending.push(entry);
  getApiErrorMessage({ response: clone }, '')
    .then(reason => {
      if (reason) entry.reason = oneLine(reason);
    })
    .catch(() => {})
    .finally(() => {
      if (!pending.includes(entry)) return; // cleared meanwhile
      pending = pending.filter(e => e !== entry);
      add(entry);
    });
}

export function getRecentErrors(): RecentError[] {
  // Pending entries show up briefly before they fold into the buffer.
  return [...errors, ...pending];
}

export function clearRecentErrors(): void {
  errors = [];
  pending = [];
}
