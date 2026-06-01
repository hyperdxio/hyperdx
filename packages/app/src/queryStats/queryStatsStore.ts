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

let events: QueryEvent[] = [];
const listeners = new Set<() => void>();

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
  try {
    const next =
      events.length >= MAX_EVENTS
        ? [...events.slice(events.length - MAX_EVENTS + 1), event]
        : [...events, event];
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
  try {
    let changed = false;
    const next = events.map(e => {
      if (e.id !== id) return e;
      changed = true;
      return { ...e, ...patch };
    });
    if (!changed) return;
    events = next;
    emit();
  } catch {
    // swallow
  }
}

export function clearQueryEvents(): void {
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

// Test-only: reset the singleton between specs.
export function __resetQueryStatsForTests(): void {
  events = [];
  listeners.clear();
}
