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

// Rounds off float dust (e.g. 3 * 1.05 giving 3.1500000000000004).
export const cleanNumber = (v: number) => Number(v.toPrecision(12));

// A format with no decimals to spend forces every tick to an integer,
// where a 2.5x10^n step (n <= 0) rounds unevenly - see niceStepsNear.
function forcesIntegerTicks(axisNumberFormat?: NumberFormat): boolean {
  if (!axisNumberFormat) return true;
  if (axisNumberFormat.output === 'duration') return false;
  return (axisNumberFormat.mantissa ?? 0) === 0;
}

// Every 1/2/5 x10^n step, plus 2.5x10^n for n > 0 (integers like 250 are
// always safe; 2.5, 0.25, ... round unevenly with no decimals to spare).
function niceStepsNear(
  target: number,
  axisNumberFormat?: NumberFormat,
): number[] {
  const exp = Math.floor(Math.log10(target));
  const excludeSmall2_5 = forcesIntegerTicks(axisNumberFormat);
  return [exp - 1, exp, exp + 1]
    .flatMap(e => {
      const includeQuarterStep = e > 0 || !excludeSmall2_5;
      const multipliers = includeQuarterStep
        ? [1, 2, 2.5, 5, 10]
        : [1, 2, 5, 10];
      return multipliers.map(m => m * 10 ** e);
    })
    .filter(step => step > 0)
    .sort((a, b) => a - b);
}

// null means the step is unusable at this magnitude (see below), which
// getNiceYAxisTicks must treat as a rejection, not as a short tick list.
function ticksWithinRange(
  step: number,
  min: number,
  max: number,
): number[] | null {
  const ticks: number[] = [];
  let t = cleanNumber(Math.ceil(min / step) * step);
  while (t <= max + step * 1e-9) {
    ticks.push(t);
    const next = cleanNumber(t + step);
    // At extreme magnitudes, float precision can make this step a no-op -
    // reject it rather than accept a truncated, collapsed tick list.
    if (next <= t) {
      return null;
    }
    t = next;
  }
  return ticks;
}

// Escalates precision past the configured mantissa, bypassing
// formatAxisTick's own selection (which can force 0 regardless).
function formatTickAtMantissa(
  value: number,
  axisNumberFormat: NumberFormat,
  mantissa: number,
): string {
  // Mirrors formatAxisTick's fixed-unit handling - re-adding the suffix it
  // drops would make budget checks reject a label that never actually renders that wide.
  if (isFixedNumericUnit(axisNumberFormat.numericUnit)) {
    return trimTrailingZeros(value.toFixed(mantissa));
  }
  return trimTrailingZeros(
    formatNumber(value, {
      ...axisNumberFormat,
      mantissa,
      average: true,
      unit: undefined,
    }),
  );
}

// Ticks must never carry duplicate labels.
const MAX_TICK_MANTISSA_ESCALATION = 4;

function isDistinct(
  ticks: number[],
  formatTick: (value: number) => string,
): boolean {
  return new Set(ticks.map(formatTick)).size === ticks.length;
}

// Reuses formatAxisTick's own per-label budget (axisLabelBudget already
// accounts for a space-separated unit suffix or a negative percent sign).
function fitsLabelBudget(
  ticks: number[],
  formatTick: (value: number) => string,
): boolean {
  return ticks.every(t => {
    const label = formatTick(t);
    return label.length <= axisLabelBudget(label);
  });
}

// Prefers formatAxisTick's normal output, but escalates precision past the
// configured mantissa when that's the only way to keep labels distinct.
function resolveDistinctTickLabels(
  ticks: number[],
  axisNumberFormat: NumberFormat | undefined,
): ((value: number) => string) | null {
  const base = (value: number) => formatAxisTick(value, axisNumberFormat);
  if (isDistinct(ticks, base)) {
    return base;
  }
  if (!axisNumberFormat) {
    // No configured mantissa to escalate - fall back to full, non-compact
    // precision, which always distinguishes any two different numbers.
    const fullPrecision = (value: number) =>
      new Intl.NumberFormat('en-US').format(value);
    return isDistinct(ticks, fullPrecision) &&
      fitsLabelBudget(ticks, fullPrecision)
      ? fullPrecision
      : null;
  }
  if (axisNumberFormat.output === 'duration') {
    // formatDurationMsCompact has no mantissa - escalate its own fixed
    // 2-3 significant digits instead, past whichever unit it picks.
    const factor = axisNumberFormat.factor ?? 1;
    for (let p = 3; p <= 3 + MAX_TICK_MANTISSA_ESCALATION; p++) {
      const escalated = (value: number) =>
        formatDurationMsCompact(value * factor * 1000, p);
      if (isDistinct(ticks, escalated) && fitsLabelBudget(ticks, escalated)) {
        return escalated;
      }
    }
    return null;
  }
  // formatAxisTick can force mantissa down to 0 regardless of what's
  // configured, so escalation must start from 1, not the configured value.
  for (let m = 1; m <= MAX_TICK_MANTISSA_ESCALATION; m++) {
    const escalated = (value: number) =>
      formatTickAtMantissa(value, axisNumberFormat, m);
    if (isDistinct(ticks, escalated) && fitsLabelBudget(ticks, escalated)) {
      return escalated;
    }
  }
  return null;
}

export interface NiceYAxisTicks {
  ticks: number[];
  tickFormatter?: (value: number) => string;
}

// Ported from packages/cli/src/termchart/scale.ts's niceTicks: the smallest
// step that fits within [min, max]/maxTicks and formats to distinct labels.
export function getNiceYAxisTicks(
  min: number,
  max: number,
  maxTicks = 5,
  axisNumberFormat?: NumberFormat,
): NiceYAxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { ticks: [] };
  }
  const steps = niceStepsNear((max - min) / (maxTicks - 1), axisNumberFormat);
  for (const step of steps) {
    const ticks = ticksWithinRange(step, min, max);
    // A single tick conveys no scale at all - never accept it, even
    // though its "labels" are trivially distinct from one another.
    if (!ticks || ticks.length < 2 || ticks.length > maxTicks) {
      continue;
    }
    const tickFormatter = resolveDistinctTickLabels(ticks, axisNumberFormat);
    if (tickFormatter) {
      return { ticks, tickFormatter };
    }
  }
  return { ticks: [] };
}

export interface ExpandableYAxisTicks {
  max: number;
  ticks: number[];
  tickFormatter?: (value: number) => string;
}

// For the plain default branch (domain may expand, as [0,'auto'] did
// pre-PR): rounds the upper bound up to fill slack under maxTicks.
export function getExpandableYAxisTicks(
  min: number,
  max: number,
  maxTicks = 5,
  axisNumberFormat?: NumberFormat,
): ExpandableYAxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { max, ticks: [] };
  }
  const steps = niceStepsNear((max - min) / (maxTicks - 1), axisNumberFormat);
  for (const step of steps) {
    const tightTicks = ticksWithinRange(step, min, max);
    // A single tick conveys no scale at all - never accept it, even
    // though its "labels" are trivially distinct from one another.
    if (!tightTicks || tightTicks.length < 2 || tightTicks.length > maxTicks) {
      continue;
    }
    const tightFormatter = resolveDistinctTickLabels(
      tightTicks,
      axisNumberFormat,
    );
    if (!tightFormatter) {
      continue;
    }
    const expandedMax = cleanNumber(Math.ceil(max / step) * step);
    // Filling a step's worth of dead space is fine, but not at the cost
    // of a large fraction of the range - keep the tight result instead.
    if (expandedMax - max <= (max - min) * 0.25) {
      const expandedTicks = ticksWithinRange(step, min, expandedMax);
      if (expandedTicks && expandedTicks.length <= maxTicks) {
        const expandedFormatter = resolveDistinctTickLabels(
          expandedTicks,
          axisNumberFormat,
        );
        if (expandedFormatter) {
          return {
            max: expandedMax,
            ticks: expandedTicks,
            tickFormatter: expandedFormatter,
          };
        }
      }
    }
    return { max, ticks: tightTicks, tickFormatter: tightFormatter };
  }
  return { max, ticks: [] };
}
