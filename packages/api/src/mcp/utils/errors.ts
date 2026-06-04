import mongoose from 'mongoose';

type McpErrorResult = {
  isError: true;
  content: [{ type: 'text'; text: string }];
};

/**
 * Build a standard MCP error response.
 */
export function mcpError(text: string): McpErrorResult {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text }],
  };
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
