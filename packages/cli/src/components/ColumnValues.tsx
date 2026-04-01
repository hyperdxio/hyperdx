/**
 * Renders a key-value list of column values from a row data object.
 * Shared between the Column Values tab and Trace tab's Event Details.
 */

import React from 'react';
import { Box, Text } from 'ink';

function flatten(s: string): string {
  return s
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const ColumnValues = React.memo(function ColumnValues({
  data,
  searchQuery,
  wrapLines,
}: {
  data: Record<string, unknown>;
  searchQuery?: string;
  wrapLines?: boolean;
}) {
  return (
    <Box flexDirection="column">
      {Object.entries(data)
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
          return (
            <Box key={key}>
              <Box width={35} flexShrink={0}>
                <Text color="cyan" wrap="truncate">
                  {key}
                </Text>
              </Box>
              <Box flexGrow={1}>
                <Text wrap={wrapLines ? 'wrap' : 'truncate'}>
                  {wrapLines ? displayVal : flatten(displayVal)}
                </Text>
              </Box>
            </Box>
          );
        })}
    </Box>
  );
});

export default ColumnValues;
