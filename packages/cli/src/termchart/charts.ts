/**
 * Static renderers: categorical bars (bar / pie), single number, table,
 * and markdown. Pure functions — data plus dimensions in, ANSI string
 * out.
 */

import chalk from 'chalk';

import {
  chalkColor,
  defaultFormatValue,
  FULL_BLOCK,
  NO_DATA_TEXT,
  truncate,
} from '@/termchart/ansi';
import type {
  CategoricalEntry,
  TableColumn,
  ValueFormatter,
} from '@/termchart/types';

/** Horizontal bars per category, largest first (bar and pie charts). */
export function renderCategoricalChart({
  entries,
  width,
  height,
  formatValue = defaultFormatValue,
  showPercentages = false,
}: {
  entries: CategoricalEntry[];
  width: number;
  height: number;
  /** Value label formatter. Default: compact number formatting */
  formatValue?: ValueFormatter;
  /** Pie charts show each slice's share of the total */
  showPercentages?: boolean;
}): string {
  if (entries.length === 0) {
    return chalk.dim(NO_DATA_TEXT);
  }

  const visible = entries.slice(0, Math.max(1, height - 1));
  const hiddenCount = entries.length - visible.length;

  const total = entries.reduce((acc, e) => acc + e.value, 0);
  const maxValue = Math.max(...visible.map(e => e.value), 0);

  const labelWidth = Math.min(
    Math.max(...visible.map(e => e.label.length), 5),
    Math.max(10, Math.floor(width * 0.3)),
  );

  const valueLabels = visible.map(e => {
    const v = formatValue(e.value);
    return showPercentages && total > 0
      ? `${v} (${((e.value / total) * 100).toFixed(1)}%)`
      : v;
  });
  const valueWidth = Math.max(...valueLabels.map(v => v.length));

  const barWidth = Math.max(5, width - labelWidth - valueWidth - 4);

  const lines = visible.map((e, i) => {
    const label = truncate(e.label, labelWidth).padEnd(labelWidth);
    const barLen =
      maxValue > 0
        ? Math.max(1, Math.round((e.value / maxValue) * barWidth))
        : 0;
    const bar = chalkColor(e.color)(FULL_BLOCK.repeat(barLen));
    return `${chalk.dim(label)} ${bar} ${valueLabels[i]}`;
  });

  if (hiddenCount > 0) {
    lines.push(chalk.dim(`… +${hiddenCount} more`));
  }

  return lines.join('\n');
}

/** A single (pre-formatted) value, centered in the tile area. */
export function renderNumberChart({
  text,
  width,
  height,
}: {
  text: string;
  width: number;
  height: number;
}): string {
  const padTop = Math.max(0, Math.floor((height - 1) / 2));
  const padLeft = Math.max(0, Math.floor((width - text.length) / 2));
  return '\n'.repeat(padTop) + ' '.repeat(padLeft) + chalk.bold(text);
}

/** Column-aligned table with numeric right-alignment and row capping. */
export function renderTableChart({
  rows,
  columns,
  width,
  height,
  formatNumericCell = (_dataKey, value) => defaultFormatValue(value),
}: {
  rows: Record<string, unknown>[];
  columns: TableColumn[];
  width: number;
  height: number;
  /** Formatter for numeric cells in non-group columns */
  formatNumericCell?: (dataKey: string, value: number) => string;
}): string {
  if (rows.length === 0 || columns.length === 0) {
    return chalk.dim(NO_DATA_TEXT);
  }

  const visibleRows = rows.slice(0, Math.max(1, height - 2));
  const hiddenCount = rows.length - visibleRows.length;

  // Format cell values first so widths account for formatting
  const formatCell = (col: TableColumn, raw: unknown): string => {
    if (raw == null) return '';
    if (!col.isGroupColumn) {
      const asNumber = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(asNumber)) {
        return formatNumericCell(col.dataKey, asNumber);
      }
    }
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  };

  const table: string[][] = visibleRows.map(row =>
    columns.map(col => formatCell(col, row[col.dataKey])),
  );

  // Column widths: fit content, then shrink the widest columns to fit
  const colWidths = columns.map((col, i) =>
    Math.max(col.displayName.length, ...table.map(r => r[i].length), 3),
  );
  const sepWidth = 2;
  const totalWidth = () =>
    colWidths.reduce((a, b) => a + b, 0) + sepWidth * (columns.length - 1);
  while (totalWidth() > width) {
    const widest = colWidths.indexOf(Math.max(...colWidths));
    if (colWidths[widest] <= 5) break;
    colWidths[widest] -= 1;
  }

  const isNumericColumn = columns.map(
    (col, i) =>
      !col.isGroupColumn &&
      table.some(
        r =>
          r[i] !== '' && Number.isFinite(Number(r[i].replace(/[^0-9.-]/g, ''))),
      ),
  );

  const renderRow = (cells: string[], styler?: (s: string) => string) =>
    cells
      .map((cell, i) => {
        const truncated = truncate(cell, colWidths[i]);
        const padded = isNumericColumn[i]
          ? truncated.padStart(colWidths[i])
          : truncated.padEnd(colWidths[i]);
        return styler ? styler(padded) : padded;
      })
      .join(' '.repeat(sepWidth));

  const lines: string[] = [];
  lines.push(
    renderRow(
      columns.map(c => c.displayName),
      s => chalk.bold.underline(s),
    ),
  );
  for (const row of table) {
    lines.push(renderRow(row));
  }
  if (hiddenCount > 0) {
    lines.push(chalk.dim(`… +${hiddenCount} more rows`));
  }

  return lines.join('\n');
}

/** Minimal markdown → terminal text (headers bolded, rest passed through). */
export function renderMarkdown(markdown: string, width: number): string {
  return markdown
    .split('\n')
    .map(line => {
      const header = line.match(/^#{1,6}\s+(.*)$/);
      if (header) {
        return chalk.bold(truncate(header[1], width));
      }
      return line;
    })
    .join('\n');
}
