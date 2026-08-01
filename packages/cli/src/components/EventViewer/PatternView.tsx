import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { PatternGroup } from './usePatternData';

// ---- Types ---------------------------------------------------------

type PatternViewProps = {
  patterns: PatternGroup[];
  selectedRow: number;
  scrollOffset: number;
  maxRows: number;
  loading: boolean;
  error: Error | null;
  wrapLines: boolean;
};

// ---- Component -----------------------------------------------------

export function PatternView({
  patterns,
  selectedRow,
  scrollOffset,
  maxRows,
  loading,
  error,
  wrapLines,
}: PatternViewProps) {
  const visible = patterns.slice(scrollOffset, scrollOffset + maxRows);
  const emptyRows = maxRows - visible.length;

  return (
    <Box flexDirection="column" marginTop={1} height={maxRows + 1}>
      {/* Header */}
      <Box overflowX="hidden">
        <Box width="12%">
          <Text bold dimColor wrap="truncate">
            Est. Count
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text bold dimColor wrap="truncate">
            Pattern
          </Text>
        </Box>
      </Box>

      {loading ? (
        <Text>
          <Spinner type="dots" /> Sampling events and mining patterns…
        </Text>
      ) : error ? (
        <Text color="red">Error: {error.message}</Text>
      ) : visible.length === 0 ? (
        <Text dimColor>No patterns found.</Text>
      ) : null}

      {!loading &&
        !error &&
        visible.map((p, i) => {
          const isSelected = i === selectedRow;
          return (
            <Box key={p.id} overflowX="hidden">
              <Box width={2}>
                <Text color="cyan" bold>
                  {isSelected ? '▸' : ' '}
                </Text>
              </Box>
              <Box width="12%" overflowX={wrapLines ? undefined : 'hidden'}>
                <Text
                  color={isSelected ? 'cyan' : 'yellow'}
                  bold={isSelected}
                  inverse={isSelected}
                  wrap={wrapLines ? 'wrap' : 'truncate'}
                >
                  ~{p.estimatedCount.toLocaleString()}
                </Text>
              </Box>
              <Box flexGrow={1} overflowX={wrapLines ? undefined : 'hidden'}>
                <Text
                  color={isSelected ? 'cyan' : undefined}
                  bold={isSelected}
                  inverse={isSelected}
                  wrap={wrapLines ? 'wrap' : 'truncate'}
                >
                  {p.pattern}
                </Text>
              </Box>
            </Box>
          );
        })}

      {emptyRows > 0 &&
        !loading &&
        Array.from({ length: emptyRows }).map((_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
    </Box>
  );
}
