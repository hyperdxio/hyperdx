import mongoose from 'mongoose';
import { z } from 'zod';

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
 * Validate that a string is a valid MongoDB ObjectId.
 * Returns an MCP error result if invalid, or `null` if valid.
 */
export function validateObjectId(
  id: string,
  label: string,
): McpErrorResult | null {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return mcpUserError(`Invalid ${label}`);
  }
  return null;
}

/** Render a Zod error as one `path: message` line per issue. */
export function formatZodIssues(error: z.ZodError): string {
  return error.errors
    .map(issue => {
      const path = issue.path
        .map((segment, index) =>
          typeof segment === 'number'
            ? `[${segment}]`
            : index === 0
              ? segment
              : `.${segment}`,
        )
        .join('');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('\n');
}
