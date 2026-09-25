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
const REASON_TIMEOUT_MS = 5_000;
const MAX_MESSAGE_LENGTH = 300;

// ClickHouse quotes the failing query in its messages, filter values included.
const QUERY_FRAGMENT =
  /(\s*In scope |\s*:?\s*while processing\b|\s*\(in query:|\s*failed at position).*$/is;

// A quoted run, with '' as an escaped quote inside it.
const QUOTED = "'(?:[^']|'')*'";
const IN_LIST = /\bIN\s*\([^)]*\)/gi;
const AFTER_VALUE_CONTEXT = new RegExp(
  `((?:[=<>]|\\bLIKE\\b|\\b(?:parse|convert)\\s+\\w+)\\s*)${QUOTED}`,
  'gi',
);
const IDENTIFIER = /^'[A-Za-z_][\w.]*'$/;
// Words ClickHouse puts right before a quoted name, optionally as a list:
// "Missing columns: 'a', 'b'", "identifier 'otel_logs'", "name 'fn'".
const NAMES_IDENTIFIER = new RegExp(
  `\\b(?:columns?|identifiers?|tables?|databases?|functions?|settings?|name)\\s*:?\\s*(?:${QUOTED}\\s*,\\s*)*$`,
  'i',
);

// With the query cut off, what is left can still quote values, and a value
// can look like an identifier ('alice'). So quoted text is blanked unless it
// directly follows a word that names an identifier, such as a missing column:
// that name is what a ticket needs.
function scrubMessage(message: string): string {
  const blank = "'?'";
  return message
    .replace(QUERY_FRAGMENT, '')
    .replace(IN_LIST, list => list.replace(new RegExp(QUOTED, 'g'), blank))
    .replace(AFTER_VALUE_CONTEXT, `$1${blank}`)
    .replace(
      new RegExp(QUOTED, 'g'),
      (quoted: string, offset: number, text: string) =>
        IDENTIFIER.test(quoted) && NAMES_IDENTIFIER.test(text.slice(0, offset))
          ? quoted
          : blank,
    );
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
  const previous = errors.find(e => sameFailure(e, entry));
  if (previous) entry.count += previous.count;
  errors = errors.filter(e => e !== previous);
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
    // Each error needs its own timestamp; same clock as directTrace.ts.
    at: new Date(performance.timeOrigin + performance.now()).toISOString(),
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
  const settle = () => {
    if (!pending.includes(entry)) return; // already settled, or cleared
    pending = pending.filter(e => e !== entry);
    add(entry);
  };
  pending.push(entry);
  // Too many waiting at once: settle the oldest without its reason.
  if (pending.length > MAX_ERRORS) {
    const oldest = pending.shift();
    if (oldest) add(oldest);
  }
  // A body that never finishes must not keep its entry pending forever.
  setTimeout(settle, REASON_TIMEOUT_MS);
  getApiErrorMessage({ response: clone }, '')
    .then(reason => {
      if (reason && pending.includes(entry)) entry.reason = oneLine(reason);
    })
    .catch(() => {})
    .finally(settle);
}

export function getRecentErrors(): RecentError[] {
  // Pending entries show up briefly before they fold into the buffer.
  return [...errors, ...pending]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_ERRORS);
}

export function clearRecentErrors(): void {
  errors = [];
  pending = [];
}
