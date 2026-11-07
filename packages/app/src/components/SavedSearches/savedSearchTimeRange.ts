import { formatDuration, intervalToDuration } from 'date-fns';
import { RelativeDateRange } from '@hyperdx/common-utils/dist/types';

import { RELATIVE_TIME_OPTIONS } from '@/components/TimePicker/utils';

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

/** The window to open a saved search with, or null to keep today's default. */
export function getSavedSearchLandingRange(
  stored: RelativeDateRange | null | undefined,
  search: string,
  nowMs: number,
): [Date, Date] | null {
  if (stored == null || hasExplicitTimeParams(search)) return null;
  if (!Number.isFinite(stored.value) || stored.value <= 0) return null;
  // Whole seconds, like parseRelativeTimeQuery, so re-parsing the displayed
  // text on the first submit lands on the same from/to.
  const end = Math.floor(nowMs / 1000) * 1000;
  return [new Date(end - stored.value * 1000), new Date(end)];
}

/** Duration of a window as a relative range, snapped to the nearest preset. */
export function toDefaultTimeRange([start, end]: [
  Date,
  Date,
]): RelativeDateRange {
  const durationMs = end.getTime() - start.getTime();
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
  | { kind: 'live' }
  | { kind: 'window'; range: [Date, Date] };

export type TimeRangeChoice = 'live' | 'keep' | 'current';

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

  let currentRange: RelativeDateRange | null = null;
  if (current.kind === 'window' && isRangeEndingNow(current.range, nowMs)) {
    const candidate = toDefaultTimeRange(current.range);
    if (stored?.value !== candidate.value) {
      currentRange = candidate;
      choices.push('current');
    }
  }

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
