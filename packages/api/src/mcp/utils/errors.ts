import mongoose from 'mongoose';

/**
 * Error category for MCP tool failures.
 *
 * - `user`   — the agent/user caused the error (bad input, not-found,
 *              bad query syntax, wrong source kind, etc.). Not alertable.
 * - `server` — unexpected system failure (uncaught exception, database
 *              outage, timeout on a system-controlled query, etc.).
 *              Alertable.
 */
export type McpErrorCategory = 'user' | 'server';

export type McpErrorResult = {
  isError: true;
  content: [{ type: 'text'; text: string }];
};

/**
 * Side-channel for error categories. Using a WeakMap instead of an object
 * property ensures `_errorCategory` can never leak through the MCP SDK's
 * `z.looseObject()` passthrough serialization, even if a result bypasses
 * `withToolTracing`.
 */
const errorCategoryMap = new WeakMap<McpErrorResult, McpErrorCategory>();

/** Retrieve the error category for a result, if one was set. */
export function getErrorCategory(
  result: McpErrorResult,
): McpErrorCategory | undefined {
  return errorCategoryMap.get(result);
}

function buildMcpError(
  text: string,
  category: McpErrorCategory,
): McpErrorResult {
  const result: McpErrorResult = {
    isError: true as const,
    content: [{ type: 'text' as const, text }],
  };
  errorCategoryMap.set(result, category);
  return result;
}

/**
 * Build an MCP error response for an agent/user-caused error (bad input,
 * not-found, bad query syntax, etc.). Not alertable.
 */
export function mcpUserError(text: string): McpErrorResult {
  return buildMcpError(text, 'user');
}

/**
 * Build an MCP error response for an unexpected system failure (uncaught
 * exception, database outage, timeout on a system-controlled query, etc.).
 * Alertable.
 */
export function mcpServerError(text: string): McpErrorResult {
  return buildMcpError(text, 'server');
}

/**
 * Build a standard MCP error response (defaults to user category).
 */
export function mcpError(text: string): McpErrorResult {
  return buildMcpError(text, 'user');
}

/**
 * Validate that a string is a valid MongoDB ObjectId.
 * Returns an MCP error result if invalid, or `null` if valid.
 */
export function validateObjectId(
  id: string,
  label: string,
): McpErrorResult | null {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return mcpError(`Invalid ${label}`);
  }
  return null;
}
