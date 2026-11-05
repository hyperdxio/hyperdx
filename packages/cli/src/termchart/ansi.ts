/**
 * ANSI/text helpers shared by the termchart renderers: escape-code
 * stripping, color mapping, truncation, number/time labels, legends,
 * and the time x-axis.
 */

import chalk from 'chalk';

import type { SeriesColor, TimeChartSeries } from '@/termchart/types';

// eslint-disable-next-line no-control-regex -- ANSI escape sequences are control chars by definition
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI color/style escape sequences from rendered chart output,
 * for non-TTY destinations (pipes, files, agents).
 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}

/** SGR foreground codes for line-plot series colors. */
export const PLOT_COLORS: Record<string, string> = {
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  blueBright: '\x1b[94m',
  yellowBright: '\x1b[93m',
  redBright: '\x1b[91m',
  greenBright: '\x1b[92m',
};

/** Map ANSI color names to chalk functions for legend / bar text. */
export function chalkColor(color: SeriesColor): (s: string) => string {
  const fn = (chalk as unknown as Record<string, unknown>)[color];
  if (typeof fn === 'function') {
    return fn as (s: string) => string;
  }
  return (s: string) => s;
}

export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

const ABBREVIATIONS: Array<[number, string]> = [
  [1e12, 't'],
  [1e9, 'b'],
  [1e6, 'm'],
  [1e3, 'k'],
];

/**
 * Default value formatter: integers as-is, fractions to 2 decimals,
 * thousands and up abbreviated (1.2k / 3.4m / …).
 */
export function defaultFormatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  for (const [threshold, suffix] of ABBREVIATIONS) {
    if (abs >= threshold) {
      return `${(value / threshold).toFixed(1)}${suffix}`;
    }
  }
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

export const FULL_BLOCK = '█';
export const PARTIAL_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export const NO_DATA_TEXT = 'No data found within time range.';

/** Format a unix-seconds timestamp for the x-axis based on range span. */
function formatTimeLabel(tsSeconds: number, rangeMs: number): string {
  const d = new Date(tsSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const monthDay = `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
  if (rangeMs <= 24 * 3600_000) {
    return hhmm;
  }
  if (rangeMs <= 7 * 24 * 3600_000) {
    return `${monthDay} ${hhmm}`;
  }
  return monthDay;
}

/** Build the x-axis line + tick labels under a plot area. */
export function renderTimeAxis({
  timestamps,
  gutterWidth,
  plotWidth,
}: {
  timestamps: number[];
  gutterWidth: number;
  plotWidth: number;
}): string {
  if (timestamps.length === 0) return '';
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const rangeMs = (last - first) * 1000;

  const startLabel = formatTimeLabel(first, rangeMs);
  const endLabel = formatTimeLabel(last, rangeMs);

  let labels: string;
  const midIdx = Math.floor(timestamps.length / 2);
  const midLabel = formatTimeLabel(timestamps[midIdx], rangeMs);
  const spaceForMid =
    plotWidth - startLabel.length - endLabel.length - midLabel.length - 4;
  if (spaceForMid > 0 && timestamps.length > 2) {
    const leftPad = Math.max(
      1,
      Math.floor(plotWidth / 2) -
        startLabel.length -
        Math.ceil(midLabel.length / 2),
    );
    const rightPad = Math.max(
      1,
      plotWidth -
        startLabel.length -
        leftPad -
        midLabel.length -
        endLabel.length,
    );
    labels =
      startLabel +
      ' '.repeat(leftPad) +
      midLabel +
      ' '.repeat(rightPad) +
      endLabel;
  } else {
    const midPad = Math.max(1, plotWidth - startLabel.length - endLabel.length);
    labels = startLabel + ' '.repeat(midPad) + endLabel;
  }

  return ' '.repeat(gutterWidth) + chalk.dim(labels);
}

/** Render the series legend (colored ● + name), capped to the width. */
export function renderLegend(
  series: Pick<TimeChartSeries, 'displayName' | 'color'>[],
  width: number,
  maxLines = 2,
  /** Series left out before layout (e.g. never drawn), counted in the tail */
  hiddenCount = 0,
): string {
  const labels = series.map(s => ({
    text: `● ${truncate(s.displayName, 40)}`,
    color: s.color,
  }));
  const lines: (typeof labels)[] = [[]];
  const lineLen = (line: typeof labels) =>
    line.reduce((n, l, i) => n + (i > 0 ? 2 : 0) + l.text.length, 0);
  for (const label of labels) {
    const last = lines[lines.length - 1];
    if (last.length > 0 && lineLen(last) + 2 + label.text.length > width) {
      if (lines.length >= maxLines) break;
      lines.push([]);
    }
    lines[lines.length - 1].push(label);
  }

  // The tail must fit on the last line, so drop labels until it does.
  const tail = (listed: number) => {
    const missing = series.length - listed + hiddenCount;
    if (missing <= 0) return '';
    return hiddenCount > 0 ? `+${missing} not shown` : `+${missing} more`;
  };
  const listed = () => lines.reduce((n, l) => n + l.length, 0);
  const fits = (line: typeof labels) =>
    lineLen(line) + (line.length > 0 ? 2 : 0) + tail(listed()).length <= width;
  if (
    tail(listed()) &&
    !fits(lines[lines.length - 1]) &&
    lines.length < maxLines
  ) {
    lines.push([]);
  }
  const last = lines[lines.length - 1];
  while (
    tail(listed()) &&
    last.length > 0 &&
    lineLen(last) + 2 + tail(listed()).length > width
  ) {
    last.pop();
  }

  const text = lines.map(line =>
    line.map(l => chalkColor(l.color)(l.text)).join('  '),
  );
  const tailText = tail(listed());
  if (tailText) {
    text[text.length - 1] = [text[text.length - 1], chalk.dim(tailText)]
      .filter(Boolean)
      .join('  ');
  }
  return text.filter(Boolean).join('\n');
}
