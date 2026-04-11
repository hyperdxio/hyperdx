import React from 'react';
import { Box, Text } from 'ink';

import type { PatternGroup } from './usePatternData';

// ---- Types ---------------------------------------------------------

type PatternViewProps = {
  patterns: PatternGroup[];
  selectedRow: number;
  scrollOffset: number;
  maxRows: number;
  totalEvents: number;
};

// ---- Component -----------------------------------------------------

export function PatternView({
  patterns,
  selectedRow,
  scrollOffset,
  maxRows,
  totalEvents,
}: PatternViewProps) {
  const visible = patterns.slice(scrollOffset, scrollOffset + maxRows);
  const emptyRows = maxRows - visible.length;

  return (
    <Box flexDirection="column" marginTop={1} height={maxRows + 1}>
      {/* Header */}
      <Box overflowX="hidden">
        <Box width="10%">
          <Text bold dimColor wrap="truncate">
            Count
          </Text>
        </Box>
        <Box width="8%">
          <Text bold dimColor wrap="truncate">
            Pct
          </Text>
        </Box>
        <Box width="82%">
          <Text bold dimColor wrap="truncate">
            Pattern
          </Text>
        </Box>
      </Box>

      {visible.length === 0 ? <Text dimColor>No patterns found.</Text> : null}

      {visible.map((p, i) => {
        const isSelected = i === selectedRow;
        const pct =
          totalEvents > 0
            ? `${((p.count / totalEvents) * 100).toFixed(1)}%`
            : '-';

        return (
          <Box key={p.id} overflowX="hidden">
            <Box width={2}>
              <Text color="cyan" bold>
                {isSelected ? '▸' : ' '}
              </Text>
            </Box>
            <Box width="10%" overflowX="hidden">
              <Text
                color={isSelected ? 'cyan' : 'yellow'}
                bold={isSelected}
                inverse={isSelected}
                wrap="truncate"
              >
                {String(p.count)}
              </Text>
            </Box>
            <Box width="8%" overflowX="hidden">
              <Text
                color={isSelected ? 'cyan' : undefined}
                dimColor={!isSelected}
                bold={isSelected}
                inverse={isSelected}
                wrap="truncate"
              >
                {pct}
              </Text>
            </Box>
            <Box width="82%" overflowX="hidden">
              <Text
                color={isSelected ? 'cyan' : undefined}
                bold={isSelected}
                inverse={isSelected}
                wrap="truncate"
              >
                {p.pattern}
              </Text>
            </Box>
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
