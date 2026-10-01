import { sanitizeFetchError } from './describeMetric';
import type { DiscoverableMetricKind } from './metricKinds';

export type MetricEntry = {
  name: string;
  kind: DiscoverableMetricKind;
  unit?: string;
  description?: string;
};

export type KindScan =
  | { status: 'pending' }
  | { status: 'ok'; names: string[] }
  | { status: 'error'; error: string };

export type KindToScan = {
  kind: DiscoverableMetricKind;
  /** Exclusive start within this kind; set only for the cursor's kind. */
  afterName?: string;
};

export type KindSlot = KindToScan & { scan: KindScan };

export type MetricsPage = {
  entries: MetricEntry[];
  /**
   * Where the next page starts. `lastName` is absent when the next page
   * starts at the beginning of `kind`. Absent when the scan is exhausted.
   */
  next?: { kind: DiscoverableMetricKind; lastName?: string };
  partialFailure: { kind: DiscoverableMetricKind; error: string }[];
};

export const KIND_TIMED_OUT_ERROR =
  'Timed out before this kind finished listing.';

/**
 * Build a page from per-kind scan results, filling `limit` entries in kind
 * order. Each scan holds up to `limit + 1` names so an overflow can be
 * detected. Returns null when a pending kind still decides the page's
 * contents, unless `finalize` is set, in which case the first pending kind
 * is reported as timed out and the page ends there.
 *
 * @internal Exported for testing.
 */
export function assembleMetricsPage(
  slots: KindSlot[],
  limit: number,
  finalize: boolean,
): MetricsPage | null {
  const entries: MetricEntry[] = [];
  const partialFailure: MetricsPage['partialFailure'] = [];
  const resumeAt = (slot: KindToScan): MetricsPage => ({
    entries,
    next: { kind: slot.kind, lastName: slot.afterName },
    partialFailure,
  });
  for (const [i, slot] of slots.entries()) {
    const { kind, scan } = slot;
    if (scan.status === 'pending') {
      if (!finalize) return null;
      // End the page at the timed-out kind so the cursor resumes there.
      // Moving on to later kinds would leave its names unreachable.
      partialFailure.push({ kind, error: KIND_TIMED_OUT_ERROR });
      return resumeAt(slot);
    }
    if (scan.status === 'error') {
      partialFailure.push({ kind, error: scan.error });
      continue;
    }
    const remaining = limit - entries.length;
    const kept = scan.names.slice(0, remaining);
    entries.push(...kept.map(name => ({ name, kind })));
    if (scan.names.length > remaining) {
      return { entries, next: { kind, lastName: kept.at(-1) }, partialFailure };
    }
    if (entries.length === limit) {
      // The page is full. Point the cursor at the next kind that may still
      // have names instead of waiting for it to finish.
      const nextSlot = slots
        .slice(i + 1)
        .find(s => s.scan.status !== 'ok' || s.scan.names.length > 0);
      return nextSlot ? resumeAt(nextSlot) : { entries, partialFailure };
    }
  }
  return { entries, partialFailure };
}

/**
 * Scan every kind in parallel and resolve as soon as the page is decided.
 * Queries for kinds that can no longer contribute are aborted. Kinds still
 * running at `deadlineAt` are reported as timed out so the kinds that
 * finished are returned instead of failing the whole call.
 */
export function scanKindsForPage({
  kinds,
  limit,
  deadlineAt,
  signal,
  fetchNames,
}: {
  kinds: KindToScan[];
  limit: number;
  deadlineAt: number;
  signal: AbortSignal;
  fetchNames: (kind: KindToScan, signal: AbortSignal) => Promise<string[]>;
}): Promise<MetricsPage> {
  const slots: KindSlot[] = kinds.map(k => ({
    ...k,
    scan: { status: 'pending' },
  }));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });

  return new Promise(resolve => {
    let done = false;
    const tryFinish = (finalize: boolean) => {
      if (done) return;
      const page = assembleMetricsPage(slots, limit, finalize);
      if (!page) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
      resolve(page);
    };
    const timer = setTimeout(
      () => tryFinish(true),
      Math.max(0, deadlineAt - Date.now()),
    );
    for (const slot of slots) {
      fetchNames(slot, controller.signal)
        .then(
          names => {
            slot.scan = { status: 'ok', names };
          },
          (e: unknown) => {
            if (done) return;
            slot.scan = { status: 'error', error: sanitizeFetchError(e) };
          },
        )
        .finally(() => tryFinish(false));
    }
    // Resolves right away when there are no kinds to scan.
    tryFinish(false);
  });
}
