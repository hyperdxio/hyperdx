import { AsyncLocalStorage } from 'node:async_hooks';

import { withQueryAttribution } from '@hyperdx/common-utils/dist/clickhouse/node';
import type { SourceKind } from '@hyperdx/common-utils/dist/types';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { recordOnboardingTaskCompletion } from '@/controllers/user';
import type { McpContext, ToolResult } from '@/mcp/tools/types';
import type { McpErrorCategory, McpErrorResult } from '@/mcp/utils/errors';
import { getErrorCategory } from '@/mcp/utils/errors';
import {
  getActiveTraceId,
  getCounter,
  getHistogram,
  type Span,
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

const toolResponseSizeHistogram = getHistogram(
  'hyperdx.mcp.tool.response.size_bytes',
  {
    description:
      'UTF-8 size of the text an MCP tool returns to the model, a proxy for the tokens it costs.',
    unit: 'By',
  },
);

type ToolSourceScope = {
  span: Span;
  /** Insertion-ordered, so the first source resolved stays the primary one. */
  sources: Map<string, SourceKind>;
};

const toolSourceScope = new AsyncLocalStorage<ToolSourceScope>();

/**
 * Records a source the current MCP tool reads on its tool span, for analytics
 * on MCP usage. The tool span is taken from the tool's own scope rather than
 * the active span, which may be a nested child span by the time a source is
 * resolved. A no-op outside a tool invocation.
 */
export function recordMcpSource(source: {
  _id: { toString(): string };
  kind: SourceKind;
}): void {
  const scope = toolSourceScope.getStore();
  if (!scope) return;
  const id = source._id.toString();
  if (scope.sources.has(id)) return;
  scope.sources.set(id, source.kind);
  if (scope.sources.size === 1) {
    scope.span.setAttribute('mcp.source.id', id);
    scope.span.setAttribute('mcp.source.kind', source.kind);
  }
  scope.span.setAttribute('mcp.source.ids', [...scope.sources.keys()]);
}

/** Metric attribute value: the primary source's kind, never its id. */
function getSourceKindLabel(scope: ToolSourceScope): SourceKind | 'none' {
  return scope.sources.values().next().value ?? 'none';
}

/** UTF-8 bytes of a tool result's text blocks: what the model has to read. */
function getResponseSizeBytes(
  content: { text?: string }[] | undefined,
): number {
  return (content ?? []).reduce(
    (total, block) => total + Buffer.byteLength(block?.text ?? '', 'utf8'),
    0,
  );
}

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
        const sourceScope: ToolSourceScope = { span, sources: new Map() };
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
          // Around the whole handler, so every query the tool makes carries
          // the tool name and who called it.
          const result = await withQueryAttribution(
            {
              surface: 'mcp',
              label: toolName,
              trace: getActiveTraceId(),
            },
            async () => toolSourceScope.run(sourceScope, () => handler(args)),
          );
          const durationMs = Date.now() - startTime;
          const sourceKind = getSourceKindLabel(sourceScope);
          const responseBytes = getResponseSizeBytes(result.content);
          span.setAttribute('mcp.tool.response.size_bytes', responseBytes);
          toolResponseSizeHistogram.record(responseBytes, {
            tool: toolName,
            outcome: result.isError ? 'error' : 'success',
          });

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
              source_kind: sourceKind,
            });
            logger.warn(
              {
                ...logContext,
                durationMs,
                responseBytes,
                errorCategory,
                errorMessage,
              },
              `MCP tool error: ${toolName}`,
            );
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
            logger.info(
              { ...logContext, durationMs, responseBytes },
              `MCP tool completed: ${toolName}`,
            );
            // Only reliable signal the user exercised the MCP server.
            recordOnboardingTaskCompletion(context.userId, 'mcp');
          }

          span.setAttribute('mcp.tool.duration_ms', durationMs);
          toolDurationHistogram.record(durationMs, {
            tool: toolName,
            source_kind: sourceKind,
          });
          return result;
        } catch (err) {
          const durationMs = Date.now() - startTime;
          const sourceKind = getSourceKindLabel(sourceScope);
          span.setAttribute('mcp.tool.duration_ms', durationMs);
          span.setAttribute('mcp.tool.error_category', 'server');
          toolDurationHistogram.record(durationMs, {
            tool: toolName,
            source_kind: sourceKind,
          });
          toolErrorCounter.add(1, {
            tool: toolName,
            error_category: 'server',
            source_kind: sourceKind,
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
