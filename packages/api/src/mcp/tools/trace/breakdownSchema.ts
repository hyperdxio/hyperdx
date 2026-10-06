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
      'SQL WHERE clause that selects the PARENT spans you want to break ' +
        'down. The tool finds the distinct TraceIds matching this filter, ' +
        'then aggregates all spans within those traces. ' +
        'Use SQL syntax (not Lucene). Example: ' +
        "\"ServiceName = '<your-service>' AND SpanName = '<your-operation>'\".\n\n" +
        'SCOPE TO A SPECIFIC OPERATION, not just a service. A service-only ' +
        'filter mixes every endpoint together and returns whatever has the ' +
        "loudest child-time across all parents, which usually isn't what " +
        'you want. Always include a SpanName (or another operation-level ' +
        'discriminator). To compare two slow operations, call this tool ' +
        'once per operation and diff the results — two operations with ' +
        "similar p99 don't necessarily share a slow child.",
    ),
  startTime: z
    .string()
    .describe('Start of the parent-filter time window as ISO 8601. REQUIRED.'),
  endTime: z
    .string()
    .describe('End of the parent-filter time window as ISO 8601. REQUIRED.'),
  minParentDurationMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      'When set, only break down parent spans whose Duration ≥ this value. ' +
        'Use to focus the breakdown on slow parents (e.g. 1000 to only look ' +
        'at parents that took ≥ 1 second).',
    ),
  topN: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe(
      'Number of top operations to return, ranked by total_time_ms DESC. Default 20.',
    ),
  maxParentTraces: z
    .number()
    .min(100)
    .max(1_000_000)
    .optional()
    .default(100_000)
    .describe(
      'Safety cap on the number of distinct parent TraceIds considered. ' +
        'A breakdown over more than this many parent traces gets ' +
        'truncated to the first N. Default 100000.',
    ),
});

export type TraceBreakdownInput = z.infer<typeof traceBreakdownSchema>;

export const TRACE_BREAKDOWN_DESCRIPTION =
  'Given a parent-span filter and a time window, return the child ' +
  'operations contributing the most cumulative time across all traces ' +
  'matching the parent filter. Same algorithm as the in-app ' +
  '"Top Most Time Consuming Operations" chart on the service dashboard.\n\n' +
  'WHAT IT DOES (two-stage, runs as one SQL):\n' +
  '  1. Pick distinct TraceIds where the parent span matches ' +
  '`parentFilter` in the window. Optionally restrict to ' +
  '`minParentDurationMs` to focus on slow parents.\n' +
  '  2. Aggregate ALL spans across those traces (excluding the ' +
  'matching root span itself) by (ServiceName, SpanName), ranked by ' +
  '`total_time_ms` DESC.\n\n' +
  'USE WHEN: investigating "where is the time going" for a slow ' +
  'operation. Filter to a specific (ServiceName, SpanName) pair and ' +
  'set `minParentDurationMs` to the threshold above which a parent ' +
  'span counts as "slow" for your investigation.\n\n' +
  'MULTIPLE OPERATIONS SLOW: when more than one operation shows ' +
  'elevated latency, call this tool ONCE PER (service, operation) ' +
  'and compare the top child rows across the result sets. Operations ' +
  'with the same top child likely share a cause; operations with ' +
  'different top children are independent regressions that happen ' +
  'to co-occur. DO NOT merge multiple operations into a single ' +
  'parentFilter — the cumulative rank then conflates independent ' +
  'investigations into one noisy answer.\n\n' +
  'RANKING METRIC: `total_time_ms = sum(Duration)` across all matching ' +
  'child spans. This captures the true contribution to elapsed time — ' +
  'a fast-but-frequent child can dominate the latency even if its p99 ' +
  'is unremarkable.\n\n' +
  'RETURNS: array of rows, each with `service`, `operation`, ' +
  '`total_time_ms`, `calls`, `in_parents` (how many parent traces ' +
  'contained at least one such span), `p50_ms`, `p99_ms`. Plus a ' +
  '`summary` block with the matched-parent count.\n\n' +
  'NEXT STEP after this tool: once a dominant slow child operation is ' +
  'identified, the canonical follow-up is clickstack_event_deltas with ' +
  'slow-vs-fast spans of THAT child operation as target/baseline ' +
  "(target = {where: SpanName='<slow-child>' AND Duration > X}, " +
  "baseline = {where: SpanName='<slow-child>' AND Duration <= Y}). " +
  'The ranked attributes surface what distinguishes slow invocations ' +
  'of the child operation from fast ones.\n\n' +
  'CROSS-SERVICE BREAKDOWN: this tool does NOT scope children to the ' +
  "parent's service. Slow cross-service calls (database, cache, " +
  'upstream HTTP) surface naturally — useful for triage.\n\n' +
  'PAIR TOOL: clickstack_trace_waterfall returns ONE concrete trace as a ' +
  "parent/child tree. Use it for an example after this tool's " +
  'aggregate breakdown has pointed you at the slow downstream operation.';
