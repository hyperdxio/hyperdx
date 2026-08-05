import { ClickHouseError } from '@clickhouse/client-common';

export const WEBHOOK_REDIRECT_ERROR_MESSAGE =
  'Webhook destination responded with a redirect. Redirects are not supported.';

export class WebhookRedirectError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(WEBHOOK_REDIRECT_ERROR_MESSAGE);
    this.name = 'WebhookRedirectError';
    this.status = status;
  }
}

// @clickhouse/client (Node) rejects with these exact messages when the
// configured request_timeout elapses or the request is aborted. See
// clickhouse-js packages/client-node/src/connection/socket_pool.ts.
const CLIENT_TIMEOUT_MESSAGE = 'Timeout error.';
const CLIENT_ABORT_MESSAGE = 'The user aborted a request.';

// ClickHouse server-side error for exceeded execution limits
// (e.g. max_execution_time): TIMEOUT_EXCEEDED, code 159.
const CH_TIMEOUT_TYPE = 'TIMEOUT_EXCEEDED';
const CH_TIMEOUT_CODE = '159';

/**
 * Check whether an error is a ClickHouseError, using both `instanceof` and a
 * constructor-name fallback. The fallback handles the case where multiple
 * copies of `@clickhouse/client-common` are installed (e.g. the api package
 * uses one version while `common-utils` bundles another) — `instanceof` fails
 * across the two class identities even though the shapes are identical.
 */
const isClickHouseError = (
  err: unknown,
): err is ClickHouseError & { type?: string; code?: string } => {
  if (err instanceof ClickHouseError) return true;
  return err instanceof Error && err.constructor?.name === 'ClickHouseError';
};

/**
 * Check whether an error is the ClickHouse client's own request_timeout
 * firing (or the request being aborted) — i.e. the client-side evaluation
 * timeout, as opposed to a server-side TIMEOUT_EXCEEDED.
 */
export const isClientTimeoutOrAbortError = (e: unknown): boolean =>
  e instanceof Error &&
  (e.message === CLIENT_TIMEOUT_MESSAGE || e.message === CLIENT_ABORT_MESSAGE);

const isTimeoutErrorShallow = (e: Error): boolean => {
  if (isClientTimeoutOrAbortError(e)) {
    return true;
  }

  if (
    isClickHouseError(e) &&
    (e.type === CH_TIMEOUT_TYPE || e.code === CH_TIMEOUT_CODE)
  ) {
    return true;
  }

  return (e as NodeJS.ErrnoException).code === 'ETIMEDOUT';
};

// Guard against pathological/self-referential cause chains.
const MAX_CAUSE_DEPTH = 5;

/**
 * Classify whether an alert query failure is a timeout/abort (rather than a
 * query or connection error). Covers:
 * - the ClickHouse client's request_timeout ("Timeout error.")
 * - aborted requests ("The user aborted a request.")
 * - server-side TIMEOUT_EXCEEDED (code 159, e.g. max_execution_time)
 * - TCP-level socket timeouts (ETIMEDOUT)
 *
 * Walks the `cause` chain: `BaseClickhouseClient.query` wraps failures in a
 * `ClickHouseQueryError` that preserves the message but keeps the original
 * error (and its identifying type/code) only on `cause`, so server-side
 * TIMEOUT_EXCEEDED and socket ETIMEDOUT would otherwise misclassify as
 * generic query errors.
 */
export const isQueryTimeoutError = (e: unknown): boolean => {
  const seen = new Set<unknown>();
  let current = e;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error) || seen.has(current)) {
      return false;
    }
    if (isTimeoutErrorShallow(current)) {
      return true;
    }
    seen.add(current);
    current = current.cause;
  }
  return false;
};
