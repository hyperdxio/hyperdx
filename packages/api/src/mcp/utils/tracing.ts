import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { McpContext, ToolResult } from '@/mcp/tools/types';
import type { McpErrorCategory, McpErrorResult } from '@/mcp/utils/errors';
import { getErrorCategory } from '@/mcp/utils/errors';
import {
  getCounter,
  getHistogram,
  SpanStatusCode,
  withSpan,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

const toolDurationHistogram = getHistogram('hyperdx.mcp.tool.duration_ms', {
  description: 'Wall-clock duration of an MCP tool invocation.',
  unit: 'ms',
});

const toolErrorCounter = getCounter('hyperdx.mcp.tool.errors', {
  description:
    'Count of MCP tool invocations that returned an error or threw an exception.',
});

/** Keeps a runaway error body from becoming the whole span status message. */
const MAX_STATUS_MESSAGE_LENGTH = 512;

/**
 * Flatten a tool result's text blocks into a span status message. Tool errors
 * carry their explanation in `content`, so without this the span shows
 * StatusCode=Error with an empty StatusMessage.
 */
function toStatusMessage(
  content: { text?: string }[] | undefined,
): string | undefined {
  // Defensive on both counts: tracing must never turn a tool error into a
  // crash, and handlers reach this through a cast in the SDK's callback type.
  const text = (content ?? [])
    .map(block => block?.text ?? '')
    .join('\n')
    .trim();
  if (!text) {
    return undefined;
  }
  return text.length > MAX_STATUS_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_STATUS_MESSAGE_LENGTH)}...`
    : text;
}

/**
 * Wraps an MCP tool handler with tracing, metrics, and structured logging.
 * Creates a span for each tool invocation and logs start/end with duration.
 *
 * The returned function signature is a strict subset of the SDK's
 * `ToolCallback`: it accepts `(args, _extra?)` and returns
 * `Promise<CallToolResult>`. The extra parameter is accepted but unused.
 */
export function withToolTracing<TArgs>(
  toolName: string,
  context: McpContext,
  handler: (args: TArgs) => Promise<ToolResult>,
): (args: TArgs, _extra?: unknown) => Promise<CallToolResult> {
  return async (args: TArgs) => {
    const { name: clientName, version: clientVersion } =
      context.mcpClient ?? {};
    const logContext = {
      tool: toolName,
      teamId: context.teamId,
      userId: context.userId,
      mcpClientName: clientName,
      mcpClientVersion: clientVersion,
    };

    return withSpan(
      `mcp.tool.${toolName}`,
      async span => {
        const startTime = Date.now();
        span.setAttribute('mcp.tool.name', toolName);
        span.setAttribute('mcp.team.id', context.teamId);
        span.setAttribute('mcp.user.id', context.userId);
        if (clientName) {
          span.setAttribute('mcp.client.name', clientName);
        }
        if (clientVersion) {
          span.setAttribute('mcp.client.version', clientVersion);
        }

        logger.info(logContext, `MCP tool invoked: ${toolName}`);

        try {
          const result = await handler(args);
          const durationMs = Date.now() - startTime;

          if (result.isError) {
            // Default to 'server' when category is not set — safe default
            // that surfaces un-classified errors in alerts.
            const errorCategory: McpErrorCategory =
              getErrorCategory(result as McpErrorResult) ?? 'server';

            const errorMessage = toStatusMessage(result.content);

            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: errorMessage,
            });
            span.setAttribute('mcp.tool.error', true);
            span.setAttribute('mcp.tool.error_category', errorCategory);
            toolErrorCounter.add(1, {
              tool: toolName,
              error_category: errorCategory,
            });
            logger.warn(
              { ...logContext, durationMs, errorCategory, errorMessage },
              `MCP tool error: ${toolName}`,
            );
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
            logger.info(
              { ...logContext, durationMs },
              `MCP tool completed: ${toolName}`,
            );
          }

          span.setAttribute('mcp.tool.duration_ms', durationMs);
          toolDurationHistogram.record(durationMs, { tool: toolName });
          return result;
        } catch (err) {
          const durationMs = Date.now() - startTime;
          span.setAttribute('mcp.tool.duration_ms', durationMs);
          span.setAttribute('mcp.tool.error_category', 'server');
          toolDurationHistogram.record(durationMs, { tool: toolName });
          toolErrorCounter.add(1, {
            tool: toolName,
            error_category: 'server',
          });

          logger.error(
            { ...logContext, durationMs, error: err },
            `MCP tool failed: ${toolName}`,
          );
          throw err;
        }
      },
      // The span status is managed inside the handler (OK vs ERROR for
      // non-throwing error results); withSpan still records exceptions and ends
      // the span on a thrown error.
      { recordOkStatus: false },
    );
  };
}
