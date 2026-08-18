/**
 * Line plotter: renders numeric series as box-drawing line charts, one
 * column per point.
 *
 * Derived from asciichart (https://github.com/kroitor/asciichart),
 * MIT License, Copyright (c) 2016 Igor Kroitor — vendored to add gap
 * support: non-finite values (NaN) render as gaps in the line instead
 * of crashing, so missing data points read as missing rather than as a
 * false drop to zero.
 */

const RESET = '\x1b[0m';

function colored(char: string, color: string | undefined): string {
  return color === undefined ? char : color + char + RESET;
}

export interface PlotConfig {
  /** Number of value intervals; the plot renders height + 1 rows. */
  height?: number;
  /** Extend the axis domain downward (data can extend it further). */
  min?: number;
  /** Extend the axis domain upward (data can extend it further). */
  max?: number;
  /** Per-series SGR color codes. */
  colors?: (string | undefined)[];
  /** Row label formatter. rowIndex 0 = top row (axis max). */
  format?: (value: number, rowIndex: number) => string;
}

/**
 * Plot one or more series as a line chart. Returns the plot rows
 * (label gutter + axis + line glyphs) joined with newlines. Non-finite
 * values are rendered as gaps; isolated finite points and segment
 * endpoints get a point marker so lone samples stay visible.
 */
export function plotLines(series: number[][], cfg: PlotConfig = {}): string {
  let min = cfg.min ?? Number.POSITIVE_INFINITY;
  let max = cfg.max ?? Number.NEGATIVE_INFINITY;
  let width = 0;

  for (const s of series) {
    width = Math.max(width, s.length);
    for (const v of s) {
      if (Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return '';
  }

  const range = Math.abs(max - min);
  const offset = 3;
  const height = cfg.height ?? range;
  const colors = cfg.colors ?? [];
  const ratio = range !== 0 ? height / range : 1;
  const min2 = Math.round(min * ratio);
  const max2 = Math.round(max * ratio);
  const rows = Math.abs(max2 - min2);
  const format =
    cfg.format ??
    ((value: number) => `           ${value.toFixed(2)}`.slice(-11));

  // Grid cells; a cell may hold a multi-character label string.
  const result: string[][] = [];
  for (let i = 0; i <= rows; i++) {
    result.push(new Array<string>(width + offset).fill(' '));
  }

  // Axis + labels. Row 0 is the top (axis max).
  for (let y = min2; y <= max2; ++y) {
    const label = format(
      rows > 0 ? max - ((y - min2) * range) / rows : y,
      y - min2,
    );
    result[y - min2][Math.max(offset - label.length, 0)] = label;
    result[y - min2][offset - 1] = y === 0 ? '┼' : '┤';
  }

  for (let j = 0; j < series.length; j++) {
    const s = series[j];
    const color = colors[j % Math.max(colors.length, 1)];
    const toRow = (v: number) => rows - (Math.round(v * ratio) - min2);

    // Mark the first finite value on the axis
    const firstFinite = s.find(v => Number.isFinite(v));
    if (firstFinite !== undefined) {
      result[toRow(firstFinite)][offset - 1] = colored('┼', color);
    }

    for (let x = 0; x < s.length; x++) {
      const v0 = s[x];
      if (!Number.isFinite(v0)) continue;
      const v1 = x < s.length - 1 ? s[x + 1] : NaN;

      if (!Number.isFinite(v1)) {
        // Gap (or series end) ahead — draw a point marker so isolated
        // samples and segment endpoints stay visible.
        result[toRow(v0)][x + offset] = colored('─', color);
        continue;
      }

      const y0 = Math.round(v0 * ratio) - min2;
      const y1 = Math.round(v1 * ratio) - min2;
      if (y0 === y1) {
        result[rows - y0][x + offset] = colored('─', color);
      } else {
        result[rows - y1][x + offset] = colored(y0 > y1 ? '╰' : '╭', color);
        result[rows - y0][x + offset] = colored(y0 > y1 ? '╮' : '╯', color);
        const from = Math.min(y0, y1);
        const to = Math.max(y0, y1);
        for (let y = from + 1; y < to; y++) {
          result[rows - y][x + offset] = colored('│', color);
        }
      }
    }
  }

  return result.map(row => row.join('')).join('\n');
}
