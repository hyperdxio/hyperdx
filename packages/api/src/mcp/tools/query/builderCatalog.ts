/**
 * Shared "prefer the builder tools over raw SQL" steering, defined once so the
 * server instructions, the clickstack_sql description, and the builder tools'
 * descriptions can't drift apart.
 */

/** Bulleted list of the builder (non-SQL) query tools and what they're for. */
export const BUILDER_TOOLS_LIST = [
  '  • clickstack_table — aggregations, top-N, single-value KPIs, breakdowns',
  '  • clickstack_timeseries — trends / metrics over time',
  '  • clickstack_search — browsing individual log/trace rows',
  '  • clickstack_event_patterns — recurring log/event pattern discovery',
  '  • clickstack_event_deltas — attributes that differ between two row groups',
  '  • clickstack_emerging_signals — patterns new or gone vs a baseline window',
  '  • clickstack_trace_waterfall — one trace as a parent/child span tree',
  '  • clickstack_trace_top_time_consuming_operations — slowest child operations in a trace',
].join('\n');

/** When raw SQL is actually warranted. */
export const SQL_FALLBACK_CRITERIA =
  'JOINs, sub-queries, CTEs, window functions, tables not registered as sources, or ' +
  'summary-type metrics (the metricTables.summary table on a metric source, which the ' +
  'builder tools cannot query)';

/**
 * Reciprocal nudge dropped into each builder tool's description. Keep it
 * generic so a single string works for every builder tool.
 */
export const PREFER_BUILDER_OVER_SQL_NUDGE =
  'PREFER THIS over clickstack_sql. Only drop to raw SQL for things the ' +
  `builder tools cannot express — ${SQL_FALLBACK_CRITERIA}.`;
