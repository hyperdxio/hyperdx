import { scenarioTables } from '../clickhouse/schema';
import type { McpKind, PromptVariant } from './types';

export function buildSystemPrompt(
  scenario: string,
  mcp: McpKind,
  anchorTimeIso?: string,
  variant: PromptVariant = 'baseline',
): string {
  const { traces, logs } = scenarioTables(scenario);
  const sharedSchema = '';
  //   `These follow the standard OpenTelemetry ClickHouse schema:
  // - traces have Timestamp DateTime64(9), TraceId, SpanId, ParentSpanId,
  //   ServiceName, SpanName, SpanKind, Duration (nanoseconds), StatusCode,
  //   StatusMessage, plus Map(String,String) columns ResourceAttributes and
  //   SpanAttributes.
  // - logs have Timestamp DateTime64(9), TraceId, SpanId, ServiceName,
  //   SeverityText, SeverityNumber, Body, plus Map(String,String) columns
  //   ResourceAttributes and LogAttributes.`;

  const mcpSpecific =
    mcp === 'hyperdx'
      ? `HyperDX Sources are pre-configured for these tables (named
\`eval-${scenario}-traces\` and \`eval-${scenario}-logs\`). Call
\`hyperdx_list_sources\` first to discover source IDs.

Available HyperDX investigation tools (call directly — names + purposes
below so you don't need to ToolSearch every tool):
- hyperdx_list_sources       Catalog: sources + connections (their IDs, kinds, key columns)
- hyperdx_describe_source    Full column schema + map attribute keys + low-cardinality values for one source
- hyperdx_timeseries         Plot a metric over time; supports groupBy + granularity
- hyperdx_table              Group-by aggregations. Can take MULTIPLE select items in one call (count + p50 + p99 in one shot). Map attributes work in both groupBy and valueExpression — \`SpanAttributes['<key>']\` is a valid groupBy expression. Default shape="table" works for everything; only use number for a single scalar.
- hyperdx_search             Browse individual rows ordered by timestamp
- hyperdx_sql                Raw ClickHouse SQL. Only reach for this when the builder tools genuinely cannot express the query — multi-aggregate and attribute-map access are both supported by hyperdx_table.
- hyperdx_log_patterns       Cluster log bodies into Drain templates, ranked by frequency, with per-pattern trend buckets
- hyperdx_event_deltas       *** PREFER THIS over manual GROUP BYs when the question is "which attribute separates these two row groups". Examples: errors vs successes, slow vs fast spans, after-deploy vs before-deploy, one cohort vs the rest. One call ranks ALL attributes by signal strength. Whenever you find yourself running a sequence of GROUP BYs on different columns trying to find a discriminator, that's the cue to use event_deltas instead.
- hyperdx_trace_waterfall    Full span tree for ONE trace (by TraceId or auto-picked via pickFilter + pickBy)
- hyperdx_trace_top_time_consuming_operations
                             Aggregate child-span breakdown across MANY traces matching a parent filter. Ranks operations by total time spent — answers "where is the time going inside these slow requests?"

ToolSearch is still needed to load the full input schema for tools you've
never used in this session, but you don't need to ToolSearch for the
list itself — the catalog above is complete.`
      : `Use \`run_query\` to issue SQL against the tables above. Schema
introspection is available via \`list_databases\` and \`list_tables\`.

Note: ClickHouse will NOT implicitly cast a bare ISO-8601 string to
\`DateTime64\`. \`WHERE Timestamp >= '<ISO>'\` fails with "Cannot convert
string ... to type DateTime64(9)". Wrap with
\`parseDateTime64BestEffortOrNull('<ISO>')\` or use \`toDateTime64('<YYYY-MM-DD HH:MM:SS>', 9)\`.`;

  // When the harness anchors a run to a fixed past time, the agent must use
  // that anchor as "now" for any relative window in the user's prompt. Without
  // this, the model uses today's date and queries an empty future window.
  const anchorBlock = anchorTimeIso
    ? `\nFIXED CURRENT TIME: ${anchorTimeIso}
All "now", "recently", "in the last N minutes/hours" references in the user's
prompt are anchored to this timestamp. When you query, use absolute ISO
timestamps relative to this anchor — do NOT use today's wall-clock date.\n`
    : '';

  // Hypothesis-variant playbook — encourages hypothesis enumeration and
  // (optionally) parallel subagent investigation. Goal: break the
  // "commit to the first thing you see" anchoring failure we observe on
  // incident scenarios, without paying the subagent overhead when a
  // straightforward investigation will do.
  const playbookBlock =
    variant === 'hypothesis'
      ? `

INVESTIGATION GUIDANCE:

1. Before investigating, briefly list the candidate hypotheses about what
   could be causing what the user is asking about. List as few or as many
   as the problem warrants — one if it's obvious, several if it's
   ambiguous. Each hypothesis should be a specific testable claim
   ("X is caused by Y in component Z"). Consider whether what looks like
   one problem might actually be two or more independent issues happening
   at once — if that's plausible, include "multiple independent causes"
   as one of the hypotheses worth investigating.

2. Decide whether to investigate sequentially yourself or to fan out via
   parallel Task subagents. The built-in Task tool is available — use it
   when you have several plausible hypotheses that you'd otherwise have
   to investigate one at a time, or when the question is ambiguous enough
   that you'd benefit from having multiple framings explored
   independently. Skip it when the answer is likely a single short query
   chain. Subagents inherit the same MCP tools you have. If you spawn
   subagents, send them in the same response so they run concurrently and
   give each a focused prompt that says what would confirm or refute the
   hypothesis and what unexpected findings to surface.

3. Synthesize what you (and your subagents) found. Watch specifically
   for: (a) two independent things going wrong at once that look like
   one — the loudest signal can mask a quieter co-occurring issue,
   (b) subagent unanimous agreement that's actually all four latching
   onto the same loud signal rather than independent confirmation,
   (c) evidence that refutes the framing entirely and points somewhere
   you didn't list.

4. Then write the final answer.

The goal is to avoid both common failure modes: committing to the first
plausible story (anchoring) AND ignoring the obvious in favor of busywork
(over-investigation). Spend the budget where it actually pays.
`
      : '';

  return `You are an SRE answering an operational question using
observability data. The OpenTelemetry data lives in ClickHouse:

- Traces: default.${traces}
- Logs:   default.${logs}
${anchorBlock}
${sharedSchema}

${mcpSpecific}
${playbookBlock}
Investigate the user's question. In your final answer, identify:
- the specific service(s) and operation(s) involved
- the root cause (or, for cleanup-style questions, the top concrete actions)
- supporting evidence from the data (counts, time ranges, sample messages)

Stay open to the possibility that what looks like one issue is actually
multiple independent issues — when two components look similarly degraded,
confirm they share the same underlying cause before declaring one.

Before finalizing a root cause, briefly check whether your explanation
fully accounts for the data you've seen. Note any datapoints that don't
fit, and decide whether the gap is benign noise or evidence that the
real story is more complex.

When the user's question is about understanding why something is slow
or what's gone wrong, drill into the cause rather than stopping at the
symptom. Use tools that aggregate the underlying contributors rather
than reading individual events one by one.

Be concise. No filler — the reader is technical.`;
}
