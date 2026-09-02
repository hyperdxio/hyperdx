export type MaxExecutionTimeBounds = {
  /** Applied when the client sends no `max_execution_time` at all. */
  defaultSeconds: number;
  /** Upper bound on a timeout the client did ask for. */
  ceilingSeconds: number;
};

/**
 * Bounds how long a proxied ClickHouse query may run.
 *
 * `max_execution_time` is a client-supplied URL setting, so a client can send
 * any value or omit it. Omitting it is the dangerous case: the query then runs
 * to whatever the ClickHouse deployment permits, and every in-flight proxied
 * query holds a slot on a tier shared by all teams, so one client can starve
 * everyone else.
 *
 * The absent case and the too-large case need different numbers. A team may
 * legitimately configure a long timeout, so the ceiling has to stay above the
 * highest value the product lets them pick — which makes it far too high to
 * serve as the default for a client that asked for nothing.
 *
 * Mutates `searchParams` in place, matching the proxy's other rewrites.
 *
 * LIMITATION: this bounds the URL setting only. ClickHouse also honours
 * `SETTINGS max_execution_time = ...` inside the SQL, which this cannot see, so
 * it is a guardrail against ordinary clients rather than a hard sandbox. The
 * hard bound is a `max_execution_time` constraint on the ClickHouse user the
 * proxy connects as.
 */
export function clampMaxExecutionTime(
  searchParams: URLSearchParams,
  { defaultSeconds, ceilingSeconds }: MaxExecutionTimeBounds,
): void {
  const usable = (value: number) => Number.isFinite(value) && value > 0;

  const requested = searchParams.get('max_execution_time');
  if (requested === null) {
    // A bad env value must not pin every query to a nonsense timeout.
    if (usable(defaultSeconds)) {
      searchParams.set('max_execution_time', String(defaultSeconds));
    }
    return;
  }

  if (!usable(ceilingSeconds)) {
    return;
  }

  // ClickHouse accepts decimals, and 0 means unlimited — which is exactly what
  // must not survive. Anything unreadable as a bounded positive number is
  // treated as a request for the ceiling.
  const parsed = Number(requested);
  if (!usable(parsed) || parsed > ceilingSeconds) {
    searchParams.set('max_execution_time', String(ceilingSeconds));
  }
}
