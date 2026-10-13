export const ONE_MIN_WINDOW = 1 * 60;
export const DEFAULT_TIME_WINDOWS_SECONDS = [
  15 * 60, // 15m
  6 * 60 * 60, // 6h
  6 * 60 * 60, // 6h
  12 * 60 * 60, // 12h
  24 * 60 * 60, // 24h
];

export type TimeWindow = {
  startTime: Date;
  endTime: Date;
  windowIndex: number;
  direction: 'ASC' | 'DESC';
};

// Generate time windows from date range using progressive bucketing, starting at the end of the date range
export function generateTimeWindowsDescending(
  startDate: Date,
  endDate: Date,
  windowDurationsSeconds: number[] = DEFAULT_TIME_WINDOWS_SECONDS,
): TimeWindow[] {
  if (startDate.getTime() === endDate.getTime()) {
    return [
      {
        startTime: startDate,
        endTime: endDate,
        windowIndex: 0,
        direction: 'DESC',
      },
    ];
  }

  const windows: TimeWindow[] = [];
  let currentEnd = new Date(endDate);
  let windowIndex = 0;

  while (currentEnd > startDate) {
    const windowSizeSeconds =
      windowDurationsSeconds.at(windowIndex) ??
      windowDurationsSeconds[windowDurationsSeconds.length - 1]; // use largest window size
    const windowSizeMs = windowSizeSeconds * 1000;
    const windowStart = new Date(
      Math.max(currentEnd.getTime() - windowSizeMs, startDate.getTime()),
    );

    windows.push({
      endTime: new Date(currentEnd),
      startTime: windowStart,
      windowIndex,
      direction: 'DESC',
    });

    currentEnd = windowStart;
    windowIndex++;
  }

  return windows;
}

// Generate time windows from date range using progressive bucketing, starting at the beginning of the date range
export function generateTimeWindowsAscending(
  startDate: Date,
  endDate: Date,
  windowDurationsSeconds: number[] = DEFAULT_TIME_WINDOWS_SECONDS,
): TimeWindow[] {
  if (startDate.getTime() === endDate.getTime()) {
    return [
      {
        startTime: startDate,
        endTime: endDate,
        windowIndex: 0,
        direction: 'ASC',
      },
    ];
  }

  const windows: TimeWindow[] = [];
  let currentStart = new Date(startDate);
  let windowIndex = 0;

  while (currentStart < endDate) {
    const windowSizeSeconds =
      windowDurationsSeconds.at(windowIndex) ??
      windowDurationsSeconds[windowDurationsSeconds.length - 1]; // use largest window size
    const windowSizeMs = windowSizeSeconds * 1000;
    const windowEnd = new Date(
      Math.min(currentStart.getTime() + windowSizeMs, endDate.getTime()),
    );

    windows.push({
      startTime: new Date(currentStart),
      endTime: windowEnd,
      windowIndex,
      direction: 'ASC',
    });

    currentStart = windowEnd;
    windowIndex++;
  }

  return windows;
}

/**
 * Windows are [start, end), so a row on a shared boundary lands on one page.
 * The window holding the caller's endTime also includes its end.
 */
export function windowInclusivity(
  window: TimeWindow,
  windowCount: number,
): { dateRangeStartInclusive: boolean; dateRangeEndInclusive: boolean } {
  const isLast = window.windowIndex === windowCount - 1;

  if (window.direction === 'DESC') {
    // Windows walk backwards: index 0 is newest, the last index is oldest.
    return {
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: window.windowIndex === 0,
    };
  }

  // ASC: index 0 is oldest, the last index is newest.
  return {
    dateRangeStartInclusive: true,
    dateRangeEndInclusive: isLast,
  };
}
