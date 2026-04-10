/**
 * Renders a key-value list of column values from a row data object.
 * Shared between the Column Values tab and Trace tab's Event Details.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

function flatten(s: string): string {
  return s
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface ColumnValuesProps {
  data: Record<string, unknown>;
  searchQuery?: string;
  wrapLines?: boolean;
  /** Max visible rows (enables scrolling viewport) */
  maxRows?: number;
  /** Scroll offset into the entries list */
  scrollOffset?: number;
}

const ColumnValues = React.memo(function ColumnValues({
  data,
  searchQuery,
  wrapLines,
  maxRows,
  scrollOffset = 0,
}: ColumnValuesProps) {
  const entries = useMemo(() => {
    return Object.entries(data)
      .filter(([key, value]) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const strVal =
          value != null && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value ?? '');
        return (
          key.toLowerCase().includes(q) || strVal.toLowerCase().includes(q)
        );
      })
      .map(([key, value]) => {
        let strVal: string;
        if (value != null && typeof value === 'object') {
          strVal = JSON.stringify(value, null, 2);
        } else {
          strVal = String(value ?? '');
        }
        let displayVal: string;
        if (strVal.startsWith('{') || strVal.startsWith('[')) {
          try {
            displayVal = JSON.stringify(JSON.parse(strVal), null, 2);
          } catch {
            displayVal = strVal;
          }
        } else {
          displayVal = strVal;
        }
        return { key, displayVal };
      });
  }, [data, searchQuery]);

  const totalEntries = entries.length;
  const visibleEntries =
    maxRows != null
      ? entries.slice(scrollOffset, scrollOffset + maxRows)
      : entries;

  return (
    <Box flexDirection="column">
      {visibleEntries.map(({ key, displayVal }) => (
        <Box
          key={key}
          height={wrapLines ? undefined : 1}
          overflowX={wrapLines ? undefined : 'hidden'}
          overflowY={wrapLines ? undefined : 'hidden'}
        >
          <Box width={35} flexShrink={0} overflowX="hidden">
            <Text color="cyan" wrap="truncate">
              {key}
            </Text>
          </Box>
          <Box flexGrow={1} overflowX={wrapLines ? undefined : 'hidden'}>
            <Text wrap={wrapLines ? 'wrap' : 'truncate'}>
              {wrapLines ? displayVal : flatten(displayVal)}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
});

export default ColumnValues;
