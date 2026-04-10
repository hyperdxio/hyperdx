/**
 * Reusable error/warning display component for the TUI.
 *
 * Renders errors and warnings with clear visual highlighting
 * so they are immediately noticeable and distinguishable from
 * normal output.
 *
 * Responsive to terminal height:
 *   - Small  (< 20 rows): compact single-line rendering
 *   - Medium (20–35 rows): bordered box with message only
 *   - Large  (> 35 rows):  full display with query context + suggestions
 *
 * Mirrors the error rendering patterns from the web frontend:
 * @source packages/app/src/DBSearchPage.tsx (queryError + ClickHouseQueryError rendering)
 * @source packages/app/src/components/DBTableChart.tsx (error message + sent query)
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';

import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';

import { useSqlSuggestions, type Suggestion } from '@/shared/useSqlSuggestions';
import { parseError, type ErrorSeverity } from '@/utils/parseError';

/** Terminal height breakpoints for responsive rendering */
const COMPACT_THRESHOLD = 20;
const FULL_THRESHOLD = 35;

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
  /** Force compact (single-line) mode regardless of terminal size */
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
 * Large terminal (> 35 rows):
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
 * Medium terminal (20–35 rows):
 * ╭─────────────────────────────────────────────────╮
 * │ ✖ Error                                         │
 * │ Syntax error: failed at position 5 ...          │
 * ╰─────────────────────────────────────────────────╯
 *
 * Small terminal (< 20 rows) or compact=true:
 * ✖ Error: Syntax error: failed at position 5
 */
export default function ErrorDisplay({
  error,
  severity = 'error',
  detail,
  searchQuery,
  compact = false,
}: ErrorDisplayProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;

  const config = SEVERITY_CONFIG[severity];
  const parsed = parseError(error, severity);

  // SQL suggestions — only when we have a search query and there's an error
  const suggestions = useSqlSuggestions({
    input: searchQuery ?? '',
    enabled: !!searchQuery && severity === 'error',
  });

  // Responsive: force compact when terminal is very small
  const useCompact = compact || termHeight < COMPACT_THRESHOLD;
  // Only show query context and suggestions in large terminals
  const showFullDetails = !useCompact && termHeight >= FULL_THRESHOLD;

  if (useCompact) {
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

      {/* Original query — only in large terminals */}
      {showFullDetails && parsed.query && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor bold>
            Sent Query:
          </Text>
          <Text dimColor wrap="wrap">
            {parsed.query}
          </Text>
        </Box>
      )}

      {/* Additional context — only in large terminals */}
      {showFullDetails && detail && (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        </Box>
      )}

      {/* SQL suggestions — only in large terminals */}
      {showFullDetails && suggestions && suggestions.length > 0 && (
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
