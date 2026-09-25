import { getTickValuesFixedDomain } from 'recharts/lib/util/scale/getNiceTickValues';

import type { NumberFormat } from '@/types';
import {
  formatDurationMsCompact,
  formatNumber,
  isFixedNumericUnit,
} from '@/utils';

// Cap on the axis mantissa search - configured Decimals can go up to 10
// (NumberFormat.tsx), but 2 already distinguishes values >= 0.005 from 0.
const MAX_AXIS_MANTISSA = 2;

/** Base width ceiling for a bare signed number - see MAX_AXIS_MANTISSA's comment. */
const AXIS_CHAR_BUDGET = 5;

// Flat, not suffix-length-scaled - IBM Plex Mono is monospace, so a longer
// suffix costs the same per character as a digit and earns no extra room.
const SEPARATOR_CHAR_ALLOWANCE = 1;

// Trims insignificant trailing zeros ("1.00k" -> "1k") and a sign left
// over from a value that rounded to zero ("-0"/"-0%" -> "0"/"0%").
function trimTrailingZeros(formatted: string): string {
  const trimmed = formatted
    .replace(/(\.\d*?)0+(?=\D*$)/, '$1')
    .replace(/\.(?=\D*$)/, '');
  return trimmed.replace(/^-(0%?)$/, '$1');
}

// A space-separated unit suffix gets its own allowance - an overflowing
// right-anchored SVG label clips off-canvas, so there's no safe rescue here.
function axisLabelBudget(formatted: string): number {
  const spaceIndex = formatted.indexOf(' ');
  if (spaceIndex !== -1) {
    return AXIS_CHAR_BUDGET + SEPARATOR_CHAR_ALLOWANCE;
  }
  const isNegativePercent =
    formatted.startsWith('-') && formatted.endsWith('%');
  return AXIS_CHAR_BUDGET + (isNegativePercent ? 1 : 0);
}

/**
 * Searches downward from the configured mantissa for the tightest fit
 * (axisLabelBudget); diverges from DBHeatmapChart's tickFormatter deliberately.
 */
export function formatAxisTick(
  value: number,
  axisNumberFormat?: NumberFormat,
): string {
  if (!axisNumberFormat) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      compactDisplay: 'short',
    }).format(value);
  }

  // formatNumber returns early for 'duration', before the mantissa/width
  // safety below ever runs, and formatDurationMs has no width budget of its
  // own - use the compact formatter instead, as DBHeatmapChart's axis does.
  if (axisNumberFormat.output === 'duration') {
    const factor = axisNumberFormat.factor ?? 1;
    return formatDurationMsCompact(value * factor * 1000);
  }

  const maxMantissa = Math.max(
    0,
    Math.min(axisNumberFormat.mantissa ?? 0, MAX_AXIS_MANTISSA),
  );
  // A fixed unit's suffix is identical on every tick, so it's dropped here
  // (unlike an auto-scale one) to spend the whole budget on precision.
  const isFixedUnit = isFixedNumericUnit(axisNumberFormat.numericUnit);
  for (let mantissa = maxMantissa; mantissa >= 0; mantissa--) {
    const candidate = trimTrailingZeros(
      isFixedUnit
        ? value.toFixed(mantissa)
        : formatNumber(value, {
            ...axisNumberFormat,
            mantissa,
            average: true,
            unit: undefined,
          }),
    );
    if (mantissa === 0 || candidate.length <= axisLabelBudget(candidate)) {
      return candidate;
    }
  }
  // Unreachable: the mantissa === 0 case above always returns.
  return '';
}

// Retries with fewer ticks until every label is distinct, so survivors
// stay evenly spaced instead of an uneven subset of a fixed-size set.
export function getYAxisTicks(
  min: number,
  max: number,
  formatTick: (value: number) => string,
): number[] {
  for (let tickCount = 5; tickCount >= 2; tickCount--) {
    const candidates = getTickValuesFixedDomain([min, max], tickCount, true);
    const labels = candidates.map(formatTick);
    if (new Set(labels).size === labels.length) {
      return candidates;
    }
  }
  // Nothing distinguishes this range at this mantissa - fall back to the
  // full set, redundant labels and all, rather than misrepresent it as flat.
  return getTickValuesFixedDomain([min, max], 5, true);
}
