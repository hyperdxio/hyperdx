import { isDateRangeEqual } from '@hyperdx/common-utils/dist/core/utils';
import { SQLInterval } from '@hyperdx/common-utils/dist/types';
import { Tooltip } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';

import { useFormatTime } from '@/useFormatTime';

interface DateRangeIndicatorProps {
  originalDateRange: [Date, Date];
  effectiveDateRange?: [Date, Date];
  mvGranularity?: SQLInterval;
}

export default function DateRangeIndicator({
  originalDateRange,
  effectiveDateRange,
  mvGranularity,
}: DateRangeIndicatorProps) {
  const formatTime = useFormatTime();

  if (
    !effectiveDateRange ||
    isDateRangeEqual(effectiveDateRange, originalDateRange)
  ) {
    return null;
  }

  const [start, end] = [
    formatTime(effectiveDateRange[0]),
    formatTime(effectiveDateRange[1]),
  ];

  const label = mvGranularity
    ? `Querying ${start} - ${end} due to ${mvGranularity} rollups in query acceleration.`
    : `Querying ${start} - ${end} to show complete intervals.`;

  return (
    <Tooltip multiline maw={500} label={label}>
      <IconClock size={16} color="var(--color-text)" />
    </Tooltip>
  );
}
