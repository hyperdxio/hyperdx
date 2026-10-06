import { Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface MultipleValuesIndicatorProps {
  seriesCount: number;
  /** How to collapse several series into one. */
  multipleSeriesHint?: string;
}

/** Warns that a single-value chart got several series back, each with its own value. */
export default function MultipleValuesIndicator({
  seriesCount,
  multipleSeriesHint,
}: MultipleValuesIndicatorProps) {
  if (seriesCount <= 1) {
    return null;
  }

  const label =
    `This query returned ${seriesCount.toLocaleString()} series, each with its own value. A number chart shows one, so the first is displayed.` +
    (multipleSeriesHint ? ` ${multipleSeriesHint}` : '');

  return (
    <Tooltip multiline maw={500} label={label}>
      <IconAlertTriangle
        size={16}
        color="var(--color-text-warning)"
        aria-label={`Query returned ${seriesCount.toLocaleString()} series`}
        data-testid="multiple-values-indicator"
      />
    </Tooltip>
  );
}
