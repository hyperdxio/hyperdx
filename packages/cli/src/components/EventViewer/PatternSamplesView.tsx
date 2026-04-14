import React from 'react';
import { Box, Text } from 'ink';

import type { PatternGroup } from './usePatternData';
import type { Column, EventRow } from './types';
import { formatDynamicRow } from './utils';
import { TableHeader } from './SubComponents';

// ---- Types ---------------------------------------------------------

type PatternSamplesViewProps = {
  pattern: PatternGroup;
  columns: Column[];
  selectedRow: number;
  scrollOffset: number;
  maxRows: number;
  wrapLines: boolean;
};

// ---- Component -----------------------------------------------------

export function PatternSamplesView({
  pattern,
  columns,
  selectedRow,
  scrollOffset,
  maxRows,
  wrapLines,
}: PatternSamplesViewProps) {
  // Reserve 3 rows for the pattern header (pattern text + count + blank line)
  const tableMaxRows = Math.max(1, maxRows - 3);
  const samples = pattern.samples;
  const visible = samples.slice(scrollOffset, scrollOffset + tableMaxRows);
  const emptyRows = tableMaxRows - visible.length;

  return (
    <Box flexDirection="column" marginTop={1} height={maxRows + 1}>
      {/* Pattern header */}
      <Box>
        <Text bold color="green">
          Pattern:{' '}
        </Text>
        <Text wrap="truncate">{pattern.pattern}</Text>
      </Box>
      <Box>
        <Text dimColor>
          ~{pattern.estimatedCount.toLocaleString()} estimated events (
          {pattern.count.toLocaleString()} sampled) — h to go back
        </Text>
      </Box>
      <Text> </Text>

      {/* Sample events table */}
      <TableHeader columns={columns} />

      {visible.map((row: EventRow, i: number) => {
        const isSelected = i === selectedRow;
        const formatted = formatDynamicRow(row, columns);
        return (
          <Box key={i} overflowX="hidden">
            <Box width={2}>
              <Text color="cyan" bold>
                {isSelected ? '▸' : ' '}
              </Text>
            </Box>
            {formatted.cells.map((cell: string, ci: number) => (
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
                        : formatted.severityColor && ci === 1
                          ? formatted.severityColor
                          : undefined
                  }
                  bold={isSelected}
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

      {emptyRows > 0 &&
        Array.from({ length: emptyRows }).map((_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
    </Box>
  );
}
