import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { McpContext } from '@/mcp/tools/types';
import {
  getCounter,
  getHistogram,
  SpanStatusCode,
  withSpan,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

/**
 * The result shape every MCP tool handler should return.
 *
 * Intersects the SDK's `CallToolResult` (which carries an index signature
 * from the `$loose` Zod modifier) with a narrower `content` array so tool
 * handlers are constrained to text-only content blocks. The intersection
 * keeps the type assignable to `CallToolResult` in both directions.
 */
export type ToolResult = CallToolResult & {
  content: { type: 'text'; text: string }[];
};

const toolDurationHistogram = getHistogram('hyperdx.mcp.tool.duration_ms', {
  description: 'Wall-clock duration of an MCP tool invocation.',
  unit: 'ms',
});

const toolErrorCounter = getCounter('hyperdx.mcp.tool.errors', {
  description:
    'Count of MCP tool invocations that returned an error or threw an exception.',
});

/**
 * Wraps an MCP tool handler with tracing, metrics, and structured logging.
 * Creates a span for each tool invocation and logs start/end with duration.
 *
 * The returned function signature is a strict subset of the SDK's
 * `ToolCallback`: it accepts `(args, _extra?)` and returns
 * `Promise<CallToolResult>`.  The extra parameter is accepted but unused.
 */
export function withToolTracing<TArgs>(
  toolName: string,
  context: McpContext,
  handler: (args: TArgs) => Promise<ToolResult>,
): (args: TArgs, _extra?: unknown) => Promise<CallToolResult> {
  return async (args: TArgs) => {
    const logContext = {
      tool: toolName,
      teamId: context.teamId,
      userId: context.userId,
    };

    return withSpan(
      `mcp.tool.${toolName}`,
      async span => {
        const startTime = Date.now();
        span.setAttribute('mcp.tool.name', toolName);
        span.setAttribute('mcp.team.id', context.teamId);
        span.setAttribute('mcp.user.id', context.userId);

        logger.info(logContext, `MCP tool invoked: ${toolName}`);

        try {
          const result = await handler(args);
          const durationMs = Date.now() - startTime;

          if (result.isError) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.setAttribute('mcp.tool.error', true);
            toolErrorCounter.add(1, { tool: toolName });
            logger.warn(
              { ...logContext, durationMs },
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
          toolDurationHistogram.record(durationMs, { tool: toolName });
          toolErrorCounter.add(1, { tool: toolName });

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
