import Papa from 'papaparse';

import { downloadTextFile } from '@/utils/downloadFile';

/** Serialize an array of objects to a CSV string. */
export function toCsvString(rows: Record<string, any>[]): string {
  return Papa.unparse(rows, {
    quotes: true,
    quoteChar: '"',
    escapeChar: '"',
    delimiter: ',',
    header: true,
  });
}

/** Writes `rows` as a CSV file. Prefix with a BOM that makes Excel read it as UTF-8. */
export function downloadCsv(
  rows: Record<string, any>[],
  filename: string,
): void {
  downloadTextFile(
    `\ufeff${toCsvString(rows)}`,
    `${filename}.csv`,
    'text/csv;charset=utf-8;',
  );
}

/** Timestamped export filename, without an extension. */
export function csvExportFilename(prefix: string): string {
  // eslint-disable-next-line no-restricted-syntax
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${timestamp}`;
}
