/** Server-side ClickHouse max_execution_time for MCP tool queries. */
export const MCP_QUERY_MAX_EXECUTION_SEC = 30;

/**
 * Default wall-clock budget for a whole MCP tool call. Kept equal to the
 * per-query cap so a single query cannot outlive the call, but set
 * separately so the two can be tuned independently.
 */
export const MCP_TOOL_TIMEOUT_MS = 30_000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => {
      if (graceMs <= 0) {
        // Settle before aborting so a result produced by an abort listener
        // cannot win the race and be reported as success.
        resolve(TIMED_OUT);
        controller.abort();
        return;
      }
      controller.abort();
      timer = setTimeout(() => resolve(TIMED_OUT), graceMs);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([work(controller.signal), deadline]);
    return result === TIMED_OUT
      ? { timedOut: true }
      : { timedOut: false, value: result };
  } catch (e) {
    if (controller.signal.aborted) return { timedOut: true };
    throw e;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
