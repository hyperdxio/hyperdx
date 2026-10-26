import { z } from 'zod';

import { KnowledgeError, KnowledgeTargetError } from '@/knowledge/errors';
import {
  type KnowledgeTarget,
  resolveKnowledgeTarget,
} from '@/knowledge/target';
import { parseTimeRange } from '@/mcp/tools/query/helpers';
import type { McpContext, ToolResult } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { setBusinessContext } from '@/utils/instrumentation';
import { trimToolResponse } from '@/utils/trimToolResponse';

export const windowSchema = {
  startTime: z
    .string()
    .describe(
      'Window start, ISO 8601. Anomalies are measured against the same-length window before it.',
    ),
  endTime: z.string().describe('Window end, ISO 8601.'),
};

export const jsonResult = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

export function trimmedJsonResult(value: object): ToolResult {
  const { data, isTrimmed } = trimToolResponse(value);
  return jsonResult(
    isTrimmed
      ? {
          ...data,
          note: 'Result was trimmed for context size. Narrow the window or lower topN.',
        }
      : data,
  );
}

// Setup errors and input errors the agent can fix become user errors; anything else propagates.
export async function withTarget(
  context: McpContext,
  fn: (t: KnowledgeTarget) => Promise<ToolResult>,
): Promise<ToolResult> {
  setBusinessContext({ teamId: context.teamId, userId: context.userId });
  try {
    return await fn(await resolveKnowledgeTarget(context.teamId));
  } catch (e) {
    if (e instanceof KnowledgeTargetError || e instanceof KnowledgeError)
      return mcpUserError(e.message);
    if (e instanceof z.ZodError)
      return mcpUserError(
        e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    throw e;
  }
}

export async function withKnowledgeTarget(
  context: McpContext,
  window: { startTime: string; endTime: string },
  fn: (t: KnowledgeTarget, range: [Date, Date]) => Promise<ToolResult>,
): Promise<ToolResult> {
  setBusinessContext({ teamId: context.teamId, userId: context.userId });
  const range = parseTimeRange(window.startTime, window.endTime);
  if ('error' in range) return mcpUserError(range.error);
  return withTarget(context, t => fn(t, [range.startDate, range.endDate]));
}
