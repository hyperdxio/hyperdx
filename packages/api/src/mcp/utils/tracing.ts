import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';

import { CODE_VERSION } from '@/config';
import logger from '@/utils/logger';

import type { McpContext } from '../tools/types';

const mcpTracer = opentelemetry.trace.getTracer('hyperdx-mcp', CODE_VERSION);

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/**
 * Wraps an MCP tool handler with tracing and structured logging.
 * Creates a span for each tool invocation and logs start/end with duration.
 */
export function withToolTracing<TArgs>(
  toolName: string,
  context: McpContext,
  handler: (args: TArgs) => Promise<ToolResult>,
): (args: TArgs) => Promise<ToolResult> {
  return async (args: TArgs) => {
    return mcpTracer.startActiveSpan(`mcp.tool.${toolName}`, async span => {
      const startTime = Date.now();
      const logContext = {
        tool: toolName,
        teamId: context.teamId,
        userId: context.userId,
      };

      span.setAttribute('mcp.tool.name', toolName);
      span.setAttribute('mcp.team.id', context.teamId);
      if (context.userId) {
        span.setAttribute('mcp.user.id', context.userId);
      }

      logger.info(logContext, `MCP tool invoked: ${toolName}`);

      try {
        const result = await handler(args);
        const durationMs = Date.now() - startTime;

        if (result.isError) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute('mcp.tool.error', true);
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
        span.end();
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(
          err instanceof Error ? err : new Error(String(err)),
        );
        span.setAttribute('mcp.tool.duration_ms', durationMs);
        span.end();

        logger.error(
          { ...logContext, durationMs, error: err },
          `MCP tool failed: ${toolName}`,
        );
        throw err;
      }
    });
  };
}
