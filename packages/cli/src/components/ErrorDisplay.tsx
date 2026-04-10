/**
 * Reusable error/warning display component for the TUI.
 *
 * Renders errors and warnings with clear visual highlighting
 * so they are immediately noticeable and distinguishable from
 * normal output.
 */

import React from 'react';
import { Box, Text } from 'ink';

import { parseError, type ErrorSeverity } from '@/utils/parseError';

interface ErrorDisplayProps {
  /** Raw error message string */
  message: string;
  /** Severity level — defaults to 'error' */
  severity?: ErrorSeverity;
  /** Optional additional context (e.g. the query that caused it) */
  detail?: string;
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
 * ┌─────────────────────────────────────┐
 * │ ✖ Error                             │
 * │ Syntax error: failed at position 5  │
 * │ Query: SELECT * FROM ...            │
 * └─────────────────────────────────────┘
 *
 * Compact mode:
 * ✖ Error: Syntax error: failed at position 5
 */
export default function ErrorDisplay({
  message,
  severity = 'error',
  detail,
  compact = false,
}: ErrorDisplayProps) {
  const config = SEVERITY_CONFIG[severity];
  const parsed = parseError(message, severity);

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
      {detail && (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        </Box>
      )}
    </Box>
  );
}
