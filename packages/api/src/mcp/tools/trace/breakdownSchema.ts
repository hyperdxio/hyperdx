import { z } from 'zod';

export const traceBreakdownSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Trace source ID. Must be a source of kind="trace". ' +
        'Call clickstack_list_sources to find available sources.',
    ),
  parentFilter: z
    .string()
    .max(4096)
    .describe(
      'SQL WHERE clause selecting the PARENT spans to break down. The tool ' +
        'finds the distinct TraceIds with a matching span in the window, then ' +
        'aggregates every other span in those traces; spans matching this ' +
        'filter are excluded from the result. SQL syntax only, not Lucene. Example: ' +
        "\"ServiceName = '<your-service>' AND SpanName = '<your-operation>'\".\n\n" +
        'SCOPE TO A SPECIFIC OPERATION, not just a service. A service-only ' +
        'filter mixes every endpoint together and returns whatever has the ' +
        "loudest child-time across all parents, which usually isn't what " +
        'you want. Always include a SpanName (or another operation-level ' +
        'discriminator). To compare two slow operations, call this tool ' +
        'once per operation and diff the results — two operations with ' +
        "similar p99 don't necessarily share a slow child. Do not combine " +
        'several operations in one filter.',
    ),
  startTime: z
    .string()
    .describe('Start of the parent-filter time window as ISO 8601.'),
  endTime: z
    .string()
    .describe('End of the parent-filter time window as ISO 8601.'),
  minParentDurationMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      'Only break down parent spans whose duration is ≥ this many ms. Set it ' +
        'to the threshold above which a parent counts as slow (e.g. 1000 for ' +
        'parents that took ≥ 1 second).',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Number of child operations to return, ranked by totalTimeMs.'),
  maxParentTraces: z
    .number()
    .min(100)
    .max(1_000_000)
    .optional()
    .default(100_000)
    .describe(
      'Safety cap on the number of distinct parent TraceIds considered. ' +
        'When more traces match, only this many are used.',
    ),
});

export type TraceBreakdownInput = z.infer<typeof traceBreakdownSchema>;

export const TRACE_BREAKDOWN_DESCRIPTION =
  'Given a parent-span filter and a time window, rank the child operations ' +
  '(ServiceName, SpanName) by cumulative time across all traces whose parent ' +
  'span matches. Same algorithm as the in-app "Top Most Time Consuming ' +
  'Operations" chart.\n\n' +
  'USE WHEN: asking "where is the time going" for a slow operation. Filter to ' +
  'one (ServiceName, SpanName) pair and set minParentDurationMs to the slow ' +
  'threshold.\n\n' +
  'MULTIPLE SLOW OPERATIONS: call this tool ONCE PER (service, operation) and ' +
  'compare the top children. A shared top child suggests a shared cause; ' +
  'different top children are independent regressions. DO NOT merge ' +
  'operations into one parentFilter — the ranking then conflates them.\n\n' +
  'RANKING: totalTimeMs = sum(Duration) of matching child spans, so a fast ' +
  'but frequent child can dominate even with an unremarkable p99. Children are ' +
  "not scoped to the parent's service, so slow cross-service calls (database, " +
  'cache, upstream HTTP) show up.\n\n' +
  'RETURNS: operations[] with service, operation, totalTimeMs, calls, ' +
  'inParents (parent traces containing that operation), p50Ms, p99Ms, and ' +
  'shareOfTotalTime, plus a summary with operationsReturned, topN, and ' +
  'grandTotalTimeMs.\n\n' +
  'NEXT STEP: once a dominant slow child is found, run clickstack_event_deltas ' +
  "on that child: target = {where: SpanName='<child>' AND Duration > X}, " +
  "baseline = {where: SpanName='<child>' AND Duration <= X}.\n\n" +
  'PAIR TOOL: clickstack_trace_waterfall shows ONE concrete trace as a ' +
  'parent/child tree, for an example after this breakdown.';
