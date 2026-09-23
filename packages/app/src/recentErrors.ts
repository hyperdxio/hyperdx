// Recent query/mutation failures, surfaced in the "Copy diagnostics" report.
// Only the error itself is recorded: query keys and SQL carry customer data.

export type RecentError = {
  at: string;
  route: string;
  name: string;
  status?: number;
  code?: number;
  message: string;
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

export function recordRecentError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const status = field(field(err, 'response'), 'status');
  // The ClickHouse client puts the code on the wrapped error's cause.
  const code = Number(
    field(err.cause, 'code') ?? err.message.match(/Code: (\d+)\./)?.[1],
  );

  errors.push({
    // Not a render path: each error needs its own timestamp.
    // eslint-disable-next-line no-restricted-syntax
    at: new Date().toISOString(),
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    name: err.name,
    ...(typeof status === 'number' ? { status } : {}),
    ...(Number.isInteger(code) ? { code } : {}),
    message: scrubMessage(err.message).slice(0, MAX_MESSAGE_LENGTH),
  });
  if (errors.length > MAX_ERRORS) errors = errors.slice(-MAX_ERRORS);
}

export function getRecentErrors(): RecentError[] {
  return [...errors];
}

export function clearRecentErrors(): void {
  errors = [];
}
