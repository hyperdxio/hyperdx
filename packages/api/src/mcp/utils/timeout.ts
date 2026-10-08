/** Server-side ClickHouse max_execution_time for MCP tool queries. */
export const MCP_QUERY_MAX_EXECUTION_SEC = 30;

/** Default wall-clock budget for a whole MCP tool call. */
export const MCP_TOOL_TIMEOUT_MS = MCP_QUERY_MAX_EXECUTION_SEC * 1000;

/**
 * Extra time past a deadline to wait for ClickHouse to return its own clean
 * timeout, or for work to wind down after its signal aborts.
 */
export const MCP_TIMEOUT_GRACE_MS = 2_000;

export type TimeoutOutcome<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

const TIMED_OUT = Symbol('timedOut');

/**
 * Run `work` under a wall-clock budget. At `timeoutMs` the signal handed to
 * `work` aborts; `graceMs` later the call stops waiting and reports a timeout.
 * Work that settles inside the grace window keeps its result, so it can
 * return partial output once it sees the abort. A rejection after the abort
 * counts as a timeout. The signal also aborts on every exit so no query
 * outlives the call.
 */
export async function runWithTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, graceMs = 0 }: { timeoutMs: number; graceMs?: number },
): Promise<TimeoutOutcome<T>> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  let backstopTimer: ReturnType<typeof setTimeout> | undefined;
  const backstop = new Promise<typeof TIMED_OUT>(resolve => {
    backstopTimer = setTimeout(() => resolve(TIMED_OUT), timeoutMs + graceMs);
  });

  try {
    const result = await Promise.race([work(controller.signal), backstop]);
    return result === TIMED_OUT
      ? { timedOut: true }
      : { timedOut: false, value: result };
  } catch (e) {
    if (controller.signal.aborted) return { timedOut: true };
    throw e;
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(backstopTimer);
    controller.abort();
  }
}
