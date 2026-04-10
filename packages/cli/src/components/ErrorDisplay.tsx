/**
 * Reusable error/warning display component for the TUI.
 *
 * Renders errors and warnings with clear visual highlighting
 * so they are immediately noticeable and distinguishable from
 * normal output.
 *
 * Mirrors the error rendering patterns from the web frontend:
 * @source packages/app/src/DBSearchPage.tsx (queryError + ClickHouseQueryError rendering)
 * @source packages/app/src/components/DBTableChart.tsx (error message + sent query)
 */

import React from 'react';
import { Box, Text } from 'ink';

import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';

import { useSqlSuggestions, type Suggestion } from '@/shared/useSqlSuggestions';
import { parseError, type ErrorSeverity } from '@/utils/parseError';

interface ErrorDisplayProps {
  /** The error — accepts a string, Error, or ClickHouseQueryError */
  error: string | Error | ClickHouseQueryError;
  /** Severity level — defaults to 'error' */
  severity?: ErrorSeverity;
  /** Optional additional context shown below the error message */
  detail?: string;
  /**
   * The user's search query — when provided alongside a ClickHouseQueryError,
   * SQL suggestions (e.g. double-quote correction) will be shown.
   * @source packages/app/src/DBSearchPage.tsx (whereSuggestions)
   */
  searchQuery?: string;
  /** Whether to render in compact (single-line) mode */
  compact?: boolean;
}

const SEVERITY_CONFIG = {
  error: {
    icon: '✖',
    label: 'Error',
    color: 'red' as const,
    borderColor: 'red' as const,
  },
  warning: {
    icon: '⚠',
    label: 'Warning',
    color: 'yellow' as const,
    borderColor: 'yellow' as const,
  },
};

/**
 * Renders a visually prominent error or warning message.
 *
 * Full mode (default):
 * ╭─────────────────────────────────────────────────╮
 * │ ✖ Error                                         │
 * │ Syntax error: failed at position 5 ...          │
 * │                                                 │
 * │ Sent Query:                                     │
 * │ SELECT * FROM default.logs WHERE "name" = 'foo' │
 * │                                                 │
 * │ 💡 ClickHouse does not support double quotes ... │
 * ╰─────────────────────────────────────────────────╯
 *
 * Compact mode:
 * ✖ Error: Syntax error: failed at position 5
 */
export default function ErrorDisplay({
  error,
  severity = 'error',
  detail,
  searchQuery,
  compact = false,
}: ErrorDisplayProps) {
  const config = SEVERITY_CONFIG[severity];
  const parsed = parseError(error, severity);

  // SQL suggestions — only when we have a search query and there's an error
  const suggestions = useSqlSuggestions({
    input: searchQuery ?? '',
    enabled: !!searchQuery && severity === 'error',
  });

  if (compact) {
    return (
      <Box>
        <Text color={config.color} bold>
          {config.icon} {config.label}:{' '}
        </Text>
        <Text color={config.color} wrap="truncate">
          {parsed.message}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={config.borderColor}
      paddingX={1}
    >
      <Text color={config.color} bold>
        {config.icon} {config.label}
      </Text>
      <Text color={config.color}>{parsed.message}</Text>

      {/* Original query — shown when the error is a ClickHouseQueryError */}
      {parsed.query && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor bold>
            Sent Query:
          </Text>
          <Text dimColor wrap="wrap">
            {parsed.query}
          </Text>
        </Box>
      )}

      {/* Additional context */}
      {detail && (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        </Box>
      )}

      {/* SQL suggestions */}
      {suggestions && suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {suggestions.map((s: Suggestion, i: number) => (
            <Text key={i} color="cyan">
              💡 {s.userMessage('where')}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
