/**
 * Utilities for parsing and classifying error messages,
 * particularly ClickHouse DB errors that can be verbose HTML
 * or include DB::Exception stack traces.
 */

export type ErrorSeverity = 'error' | 'warning';

export interface ParsedError {
  severity: ErrorSeverity;
  /** Human-readable summary of the error */
  message: string;
  /** Optional additional context (e.g. the query that caused it) */
  detail?: string;
}

const MAX_MESSAGE_LENGTH = 500;

/**
 * Extract a readable message from a ClickHouse DB::Exception string.
 *
 * ClickHouse errors typically look like:
 *   "Code: 62. DB::Exception: Syntax error: failed at position 5 ... (SYNTAX_ERROR) (version 24.8.1.1)"
 *
 * We extract everything up to the first "(version" or the error code suffix.
 */
function parseClickHouseException(raw: string): string {
  // Strip the leading "Code: NNN. " prefix for readability
  let msg = raw.replace(/^Code:\s*\d+\.\s*/, '');

  // Strip "DB::Exception: " prefix
  msg = msg.replace(/^DB::Exception:\s*/, '');

  // Strip trailing version info — e.g. "(version 24.8.1.1)"
  msg = msg.replace(/\s*\(version\s+[^)]+\)\s*$/, '');

  // Strip stack trace lines (lines starting with numbers like "0. ...")
  msg = msg
    .split('\n')
    .filter(line => !/^\d+\.\s+0x/.test(line.trim()))
    .join('\n')
    .trim();

  return msg;
}

/**
 * Strip HTML tags from a string — ClickHouse proxy errors sometimes
 * return full HTML error pages.
 */
function stripHtml(raw: string): string {
  // Extract text from <title> if present (often has the best summary)
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  // Fall back to stripping all tags
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a raw error message/string into a structured ParsedError.
 */
export function parseError(
  raw: string,
  severity: ErrorSeverity = 'error',
): ParsedError {
  if (!raw || raw.trim().length === 0) {
    return { severity, message: 'An unknown error occurred.' };
  }

  let message = raw.trim();

  // Handle HTML error responses
  if (message.startsWith('<!') || message.startsWith('<html')) {
    message = stripHtml(message);
  }

  // Handle ClickHouse DB::Exception
  if (message.includes('DB::Exception')) {
    message = parseClickHouseException(message);
  }

  // Truncate if still too long
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.slice(0, MAX_MESSAGE_LENGTH) + '…';
  }

  return { severity, message };
}
