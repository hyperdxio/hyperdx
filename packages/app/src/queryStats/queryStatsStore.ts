import { useSyncExternalStore } from 'react';

export type QueryStatus = 'pending' | 'done' | 'error' | 'cancelled';

export type QueryEventKind = 'query' | 'explain';

export type QueryEvent = {
  id: string;
  queryId: string;
  sql: string;
  params: Record<string, any>;
  status: QueryStatus;
  startedAt: number;
  durationMs?: number;
  pathname: string;
  error?: string;
  connectionId?: string;
  kind: QueryEventKind;
};

const MAX_EVENTS = 200;
// Truncate large captured strings so a runaway chart config can't pin
// tens of MB in the buffer for the tab's lifetime.
const MAX_STRING_LEN = 32_000;
const TRUNCATION_MARK = '\n…[truncated]';

let events: QueryEvent[] = [];
const listeners = new Set<() => void>();

function truncate(s: string | undefined): string | undefined {
  if (s == null) return s;
  if (s.length <= MAX_STRING_LEN) return s;
  return s.slice(0, MAX_STRING_LEN) + TRUNCATION_MARK;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // never let a bad listener take down the producer
    }
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): readonly QueryEvent[] {
  return events;
}

export function appendQueryEvent(event: QueryEvent): void {
  if (!isBrowser()) return;
  try {
    const truncated: QueryEvent = {
      ...event,
      sql: truncate(event.sql) ?? '',
      error: truncate(event.error),
    };
    const next =
      events.length >= MAX_EVENTS
        ? [...events.slice(events.length - MAX_EVENTS + 1), truncated]
        : [...events, truncated];
    events = next;
    emit();
  } catch {
    // swallow — instrumentation must never throw into the wrapper
  }
}

export function updateQueryEvent(
  id: string,
  patch: Partial<Omit<QueryEvent, 'id'>>,
): void {
  if (!isBrowser()) return;
  try {
    const truncatedPatch: Partial<Omit<QueryEvent, 'id'>> = {
      ...patch,
      ...(patch.sql !== undefined ? { sql: truncate(patch.sql) ?? '' } : {}),
      ...(patch.error !== undefined ? { error: truncate(patch.error) } : {}),
    };
    let changed = false;
    const next = events.map(e => {
      if (e.id !== id) return e;
      changed = true;
      return { ...e, ...truncatedPatch };
    });
    if (!changed) return;
    events = next;
    emit();
  } catch {
    // swallow
  }
}

export function clearQueryEvents(): void {
  if (!isBrowser()) return;
  try {
    events = [];
    emit();
  } catch {
    // swallow
  }
}

export function useQueryEvents(): readonly QueryEvent[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: reset the singleton between specs. Guarded so an accidental
// import from production code is a no-op.
export function __resetQueryStatsForTests(): void {
  if (process.env.NODE_ENV === 'production') return;
  events = [];
  listeners.clear();
}
