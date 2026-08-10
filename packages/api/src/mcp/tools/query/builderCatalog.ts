/**
 * Single source of truth for the "prefer the builder tools over raw SQL"
 * steering that appears in three places:
 *   - the server-level instructions (mcpServer.ts),
 *   - the clickstack_sql description (which lists the alternatives), and
 *   - each builder tool's own description (the reciprocal "prefer me" nudge).
 *
 * Defining the catalog once keeps those lists from silently drifting apart
 * (e.g. a new builder tool being added to one place but not the others).
 */

/** The canonical reason SQL is a last resort — shared by every nudge. */
export const SQL_FALLBACK_CRITERIA =
  'JOINs, sub-queries, CTEs, window functions, or tables not registered as sources';

/**
 * One entry per builder (non-SQL) query tool. `blurb` is the one-liner shown
 * in the steering lists. `preferHint`, when present, is the tool-specific
 * clause used in that tool's own "prefer me over SQL" nudge.
 */
export type BuilderTool = {
  name: string;
  /** One-liner for the bulleted steering lists. */
  blurb: string;
  /**
   * Tool-specific phrasing for the reciprocal nudge in the tool's own
   * description, e.g. "for any single-source aggregation". Omit for tools
   * that only need to appear in the steering lists (not every tool has a
   * hand-written description edit).
   */
  preferHint?: string;
};

/**
 * The builder-tool catalog. Order is the order they appear in steering lists.
 * Keep this in sync with the registered tools in tools/query and tools/trace.
 */
export const BUILDER_TOOLS: readonly BuilderTool[] = [
  {
    name: 'clickstack_table',
    blurb: 'aggregations, top-N, single-value KPIs, breakdowns',
    preferHint: 'for any single-source aggregation',
  },
  {
    name: 'clickstack_timeseries',
    blurb: 'trends / metrics over time',
    preferHint:
      'for any time-bucketed query — do not hand-roll toStartOfInterval SQL',
  },
  {
    name: 'clickstack_search',
    blurb: 'browsing individual log/trace rows',
    preferHint: 'for browsing/filtering rows from a single source',
  },
  {
    name: 'clickstack_event_patterns',
    blurb: 'discover recurring log/event patterns (clustering)',
    preferHint: 'for pattern / recurring-shape discovery',
  },
  {
    name: 'clickstack_event_deltas',
    blurb: 'rank the attributes that differ between two row groups',
    preferHint: 'for target-vs-baseline attribute-shift analysis',
  },
  {
    name: 'clickstack_emerging_signals',
    blurb:
      'detect log/event patterns that are new or gone vs a baseline window',
  },
  {
    name: 'clickstack_trace_waterfall',
    blurb: 'inspect one trace as a parent/child span tree',
  },
  {
    name: 'clickstack_trace_top_time_consuming_operations',
    blurb: 'rank the child operations contributing the most time in a trace',
  },
] as const;

/**
 * Bulleted steering list, e.g.
 *   • clickstack_table — aggregations, top-N, single-value KPIs, breakdowns
 * `bullet` and `indent` let callers match the surrounding style (the server
 * instructions and the sql.ts description differ slightly).
 */
export function builderToolBulletList(
  opts: { indent?: string; bullet?: string } = {},
): string {
  const indent = opts.indent ?? '  ';
  const bullet = opts.bullet ?? '•';
  return BUILDER_TOOLS.map(
    t => `${indent}${bullet} ${t.name} — ${t.blurb}`,
  ).join('\n');
}

/**
 * The reciprocal "prefer this over raw SQL" nudge for a single builder tool's
 * own description. Throws if the tool has no `preferHint` (a wiring mistake we
 * want to fail loudly at module load, not silently omit).
 */
export function preferOverSqlNudge(name: string): string {
  const tool = BUILDER_TOOLS.find(t => t.name === name);
  if (!tool || !tool.preferHint) {
    throw new Error(
      `preferOverSqlNudge: no builder tool with a preferHint named "${name}"`,
    );
  }
  return (
    `PREFER THIS over clickstack_sql ${tool.preferHint}. ` +
    `Only drop to raw SQL for things this tool cannot express — ` +
    `${SQL_FALLBACK_CRITERIA}.`
  );
}
