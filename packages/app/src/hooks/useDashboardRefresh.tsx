'use client';

import React from 'react';
import { useDocumentVisibility } from '@mantine/hooks';

import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
} from '@/ChartUtils';

export const useDashboardRefresh = ({
  searchedTimeRange,
  onTimeRangeSelect,
  isLive,
}: {
  onTimeRangeSelect: (start: Date, end: Date) => void;
  searchedTimeRange: [Date, Date];
  isLive: boolean;
}) => {
  const [manualRefreshCooloff, setManualRefreshCooloff] = React.useState(false);

  const isTabVisible = useDocumentVisibility() === 'visible';

  const isRefreshEnabled = React.useMemo(() => {
    return isTabVisible && isLive;
  }, [isTabVisible, isLive]);

  const refresh = React.useCallback(() => {
    const timeDiff =
      searchedTimeRange[1].getTime() - searchedTimeRange[0].getTime();
    const timeDiffRoundedToSecond = Math.round(timeDiff / 1000) * 1000;
    const newEnd = new Date();
    const newStart = new Date(newEnd.getTime() - timeDiffRoundedToSecond);
    onTimeRangeSelect(newStart, newEnd);
    setManualRefreshCooloff(true);
    setTimeout(() => {
      setManualRefreshCooloff(false);
    }, 1000);
  }, [onTimeRangeSelect, searchedTimeRange]);

  const granularityOverride = convertDateRangeToGranularityString(
    searchedTimeRange,
    60,
  );

  // Auto-refresh interval
  const intervalRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (isRefreshEnabled) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      intervalRef.current = window.setInterval(() => {
        refresh();
      }, convertGranularityToSeconds(granularityOverride) * 1000);
    } else {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [isRefreshEnabled, granularityOverride, refresh]);

  return {
    granularityOverride,
    isRefreshEnabled,
    manualRefreshCooloff,
    refresh,
  };
};
