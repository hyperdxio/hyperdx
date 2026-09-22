import { Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface MultipleValuesIndicatorProps {
  valueCount: number;
  seriesCount: number;
  /** How to collapse several series into one. */
  multipleSeriesHint?: string;
  /** How to make one series yield a single value. */
  multipleValuesHint?: string;
}

/**
 * Warns that a single-value chart got more than one value back, naming which
 * of the two causes it is: several series, each with its own value, or one
 * series carrying several values over time.
 */
export default function MultipleValuesIndicator({
  valueCount,
  seriesCount,
  multipleSeriesHint,
  multipleValuesHint,
}: MultipleValuesIndicatorProps) {
  if (valueCount <= 1) {
    return null;
  }

  const isMultipleSeries = seriesCount > 1;
  const summary = isMultipleSeries
    ? `This query returned ${seriesCount.toLocaleString()} series, each with its own value.`
    : `This query returned ${valueCount.toLocaleString()} values for a single series.`;
  const hint = isMultipleSeries ? multipleSeriesHint : multipleValuesHint;
  const label =
    `${summary} A number chart shows one, so the first is displayed.` +
    (hint ? ` ${hint}` : '');

  return (
    <Tooltip multiline maw={500} label={label}>
      <IconAlertTriangle
        size={16}
        color="var(--color-text-warning)"
        aria-label={
          isMultipleSeries
            ? `Query returned ${seriesCount.toLocaleString()} series`
            : `Query returned ${valueCount.toLocaleString()} values for one series`
        }
        data-testid="multiple-values-indicator"
      />
    </Tooltip>
  );
}
