import { formatDuration, intervalToDuration } from 'date-fns';
import { RelativeDateRange } from '@hyperdx/common-utils/dist/types';

import {
  LIVE_TAIL_DURATION_MS,
  RELATIVE_TIME_OPTIONS,
} from '@/components/TimePicker/utils';
import { parseRelativeTimeQuery } from '@/timeQuery';

/**
 * URL params that mean the link already chose a time, so a saved search's
 * default time range must not override it. Not `from`/`to`: live tail writes
 * those on every tick and they mean live tail unless `isLive=false` is also
 * set, which every link to a specific window (alerts, save redirects) carries.
 */
const EXPLICIT_TIME_PARAMS = ['isLive', 'liveInterval'] as const;

export function hasExplicitTimeParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return EXPLICIT_TIME_PARAMS.some(key => params.has(key));
}

const SNAP_TOLERANCE_MS = 1000;
const ENDS_NOW_MIN_TOLERANCE_MS = 60 * 1000;

/** Durations live tail can stream (the presets with relative support). */
export function isLiveTailDuration(durationMs: number): boolean {
  return RELATIVE_TIME_OPTIONS.some(
    option =>
      option !== 'divider' && option[2] === true && option[1] === durationMs,
  );
}

export type SavedSearchLanding =
  | { kind: 'live'; intervalMs: number }
  | { kind: 'window'; range: [Date, Date] };

/**
 * How to open a saved search, or null to keep today's default. Ranges live
 * tail supports open as live tail; longer ones open as a window ending now.
 */
export function getSavedSearchLanding(
  stored: RelativeDateRange | null | undefined,
  search: string,
  nowMs: number,
): SavedSearchLanding | null {
  if (stored == null || hasExplicitTimeParams(search)) return null;
  const durationMs = stored.value * 1000;
  if (isLiveTailDuration(durationMs)) {
    return { kind: 'live', intervalMs: durationMs };
  }
  // Whole seconds, so re-parsing the displayed text on the first submit lands
  // on the same from/to.
  return { kind: 'window', range: parseRelativeTimeQuery(durationMs, nowMs) };
}

/** Duration of a window as a relative range, snapped to the nearest preset. */
export function toDefaultTimeRange(durationMs: number): RelativeDateRange {
  for (const option of RELATIVE_TIME_OPTIONS) {
    if (option === 'divider') continue;
    if (Math.abs(option[1] - durationMs) <= SNAP_TOLERANCE_MS) {
      return { type: 'relative', value: option[1] / 1000 };
    }
  }
  return { type: 'relative', value: Math.round(durationMs / 1000) };
}

/**
 * A window only reads as "the past N" if it ends about now. The floor absorbs
 * re-parse drift and time spent editing before saving.
 */
export function isRangeEndingNow(
  [start, end]: [Date, Date],
  nowMs: number,
): boolean {
  const tolerance = Math.max(
    ENDS_NOW_MIN_TOLERANCE_MS,
    (end.getTime() - start.getTime()) * 0.1,
  );
  return Math.abs(end.getTime() - nowMs) <= tolerance;
}

/** "1 day", "1 hour 30 minutes". Anchored at epoch 0 so DST never shifts it. */
export function formatRelativeDuration(seconds: number): string {
  return formatDuration(intervalToDuration({ start: 0, end: seconds * 1000 }));
}

export type CurrentTimeRange =
  | { kind: 'live'; intervalMs: number }
  | { kind: 'window'; range: [Date, Date] };

export type TimeRangeChoice = 'live' | 'keep' | 'current';

function getCurrentCandidate(
  current: CurrentTimeRange,
  nowMs: number,
): RelativeDateRange | null {
  if (current.kind === 'live') {
    // Plain live tail is already what a search opens with by default.
    return current.intervalMs === LIVE_TAIL_DURATION_MS
      ? null
      : toDefaultTimeRange(current.intervalMs);
  }
  if (!isRangeEndingNow(current.range, nowMs)) return null;
  const [start, end] = current.range;
  return toDefaultTimeRange(end.getTime() - start.getTime());
}

export function getTimeRangeChoices({
  current,
  stored,
  nowMs,
}: {
  current: CurrentTimeRange;
  stored: RelativeDateRange | null | undefined;
  nowMs: number;
}): {
  choices: TimeRangeChoice[];
  defaultChoice: TimeRangeChoice;
  currentRange: RelativeDateRange | null;
} {
  const choices: TimeRangeChoice[] = ['live'];
  if (stored != null) choices.push('keep');

  const candidate = getCurrentCandidate(current, nowMs);
  const currentRange =
    candidate != null && stored?.value !== candidate.value ? candidate : null;
  if (currentRange != null) choices.push('current');

  return {
    choices,
    defaultChoice: stored != null ? 'keep' : 'live',
    currentRange,
  };
}

/**
 * The `defaultTimeRange` to send: a value to store, null to clear, or
 * undefined to omit the key (the server keeps what is stored on update).
 */
export function resolveDefaultTimeRange({
  isUpdate,
  choice,
  stored,
  currentRange,
}: {
  isUpdate: boolean;
  choice: TimeRangeChoice;
  stored: RelativeDateRange | null | undefined;
  currentRange: RelativeDateRange | null;
}): RelativeDateRange | null | undefined {
  switch (choice) {
    case 'keep':
      // "Save as new" copies the range of the search it came from.
      return isUpdate ? undefined : (stored ?? undefined);
    case 'current':
      return currentRange ?? undefined;
    case 'live':
      return isUpdate && stored != null ? null : undefined;
  }
}
