import React from 'react';
import { Box, Text } from 'ink';

import ErrorDisplay from '@/components/ErrorDisplay';

import type { Column, FormattedRow } from './types';
import { TableHeader } from './SubComponents';

type VisibleRow = FormattedRow & { raw: Record<string, string | number> };

type TableViewProps = {
  columns: Column[];
  visibleRows: VisibleRow[];
  selectedRow: number;
  focusSearch: boolean;
  wrapLines: boolean;
  maxRows: number;
  error: Error | null;
  searchQuery?: string;
  loading: boolean;
};

export function TableView({
  columns,
  visibleRows,
  selectedRow,
  focusSearch,
  wrapLines,
  maxRows,
  error,
  searchQuery,
  loading,
}: TableViewProps) {
  return (
    <Box flexDirection="column" marginTop={1} height={maxRows + 1}>
      <TableHeader columns={columns} />

      {error ? (
        <ErrorDisplay
          error={error}
          severity="error"
          searchQuery={searchQuery}
        />
      ) : visibleRows.length === 0 && !loading ? (
        <Text dimColor>No events found.</Text>
      ) : null}

      {visibleRows.map((row, i) => {
        const isSelected = i === selectedRow && !focusSearch;
        return (
          <Box key={i} overflowX="hidden">
            <Box width={2}>
              <Text color="cyan" bold>
                {isSelected ? '▸' : ' '}
              </Text>
            </Box>
            {row.cells.map((cell, ci) => (
              <Box
                key={ci}
                width={columns[ci]?.width ?? '10%'}
                overflowX={wrapLines ? undefined : 'hidden'}
              >
                <Text
                  wrap={wrapLines ? 'wrap' : 'truncate'}
                  color={
                    isSelected
                      ? 'cyan'
                      : ci === 0
                        ? 'gray'
                        : row.severityColor && ci === 1
                          ? row.severityColor
                          : undefined
                  }
                  bold={(ci === 1 && !!row.severityColor) || isSelected}
                  dimColor={ci === 0 && !isSelected}
                  inverse={isSelected}
                >
                  {cell}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}

      {visibleRows.length < maxRows &&
        Array.from({ length: maxRows - visibleRows.length }).map((_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
    </Box>
  );
}
