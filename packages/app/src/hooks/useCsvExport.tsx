import { useMemo } from 'react';

const DEFAULT_MAX_ROWS = 4000;

export interface CsvColumn {
  dataKey: string;
  displayName: string;
}

export interface CsvExportOptions {
  maxRows?: number;
  groupColumnName?: string;
}

export interface CsvExportResult {
  csvData: Record<string, any>[];
  maxRows: number;
  isDataEmpty: boolean;
  actualRowCount: number;
  isLimited: boolean;
}

const generateCsvData = (
  data: unknown[],
  columns: CsvColumn[],
  options: CsvExportOptions = {},
): Record<string, any>[] => {
  const { groupColumnName } = options;

  if (!Array.isArray(data)) {
    console.warn('CSV Export: data must be an array');
    return [];
  }

  if (!Array.isArray(columns) || columns.length === 0) {
    console.warn('CSV Export: columns must be a non-empty array');
    return [];
  }

  const invalidColumns = columns.filter(
    col =>
      !col ||
      typeof col.dataKey !== 'string' ||
      typeof col.displayName !== 'string',
  );

  if (invalidColumns.length > 0) {
    console.warn(
      'CSV Export: Invalid column structure detected',
      invalidColumns,
    );
    return [];
  }

  return data
    .filter(
      (row): row is Record<string, any> =>
        row != null && typeof row === 'object',
    )
    .map((row, index) => {
      try {
        return {
          ...(groupColumnName != null
            ? { [groupColumnName]: row.group ?? '' }
            : {}),
          ...Object.fromEntries(
            columns.map(({ displayName, dataKey }) => {
              const value = row[dataKey];

              if (value == null) {
                return [displayName, ''];
              }

              if (typeof value === 'object') {
                return [displayName, JSON.stringify(value)];
              }

              return [displayName, String(value)];
            }),
          ),
        };
      } catch (error) {
        console.warn(`CSV Export: Error processing row ${index}:`, error);
        return {};
      }
    })
    .filter(row => Object.keys(row).length > 0);
};

export const useCsvExport = (
  data: unknown[],
  columns: CsvColumn[],
  options: CsvExportOptions = {},
): CsvExportResult => {
  const { maxRows = DEFAULT_MAX_ROWS, groupColumnName } = options;

  const result = useMemo(() => {
    const isDataEmpty = !Array.isArray(data) || data.length === 0;

    if (isDataEmpty || !Array.isArray(columns) || columns.length === 0) {
      return {
        csvData: [],
        maxRows,
        isDataEmpty: true,
        actualRowCount: 0,
        isLimited: false,
      };
    }

    const limitedData = data.slice(0, maxRows);
    const csvData = generateCsvData(limitedData, columns, { groupColumnName });

    return {
      csvData,
      maxRows,
      isDataEmpty: false,
      actualRowCount: csvData.length,
      isLimited: data.length > maxRows,
    };
  }, [data, columns, maxRows, groupColumnName]);

  return result;
};
