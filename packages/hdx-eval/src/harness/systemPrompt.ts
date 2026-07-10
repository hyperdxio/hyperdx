import { scenarioTables } from '@/clickhouse/schema';
import type { Scenario } from '@/scenarios/types';

import type { PromptVariant } from './types';

/**
 * Caveat injected alongside the FIXED CURRENT TIME anchor.
 *
 * `clickstack_describe_source` samples its `lowCardinalityValues`,
 * `mapAttributeValues`, and `mapAttributeKeys` over a fixed wall-clock
 * window (last 24h of REAL time), independent of the anchor above. In evals
 * the seeded data is anchored to a fixed timestamp that can be older than
 * that window, so those sampled fields may come back empty or partial —
 * which is misleading, not just missing (an empty sample looks like "the
 * value doesn't exist"). Tell the agent not to trust them and to discover
 * real values via an anchored query instead. The `columns` schema from
 * describe_source is unaffected (no time filter) and remains reliable.
 */
export const SAMPLING_CAVEAT_BLOCK = `
DATA DISCOVERY CAVEAT: clickstack_describe_source's sampled value fields
(lowCardinalityValues, mapAttributeValues, mapAttributeKeys) are sampled
over the last 24h of WALL-CLOCK time, NOT the FIXED CURRENT TIME above, so
they may be EMPTY or incomplete for this data. Do NOT treat an empty or
missing sample as proof that a value/service/attribute does not exist.
The columns/schema from describe_source ARE reliable. To discover the
actual values, services, and attribute keys present, run an anchored
clickstack_table (e.g. group by ServiceName) or clickstack_search over the
FIXED CURRENT TIME window rather than relying on describe_source samples.
`;

/**
 * Build the system prompt for a scenario run.
 *
 * If the scenario provides a `buildSystemPrompt` hook, it is called instead
 * of the default investigation prompt. This lets new scenario kinds (dashboard,
 * alert, etc.) define their own instructions without modifying this file.
 */
export function buildSystemPrompt(
  scenario: Scenario,
  anchorTimeIso?: string,
  variant: PromptVariant = 'baseline',
  maxTurns?: number,
): string {
  // Scenario-provided custom system prompt — used by dashboard-build, etc.
  if (scenario.buildSystemPrompt) {
    const tables = scenarioTables(scenario.name);
    return scenario.buildSystemPrompt({
      tables,
      anchorTimeIso,
      maxTurns,
      variant,
    });
  }

  // Default: SRE investigation prompt.
  return buildInvestigationSystemPrompt(
    scenario.name,
    anchorTimeIso,
    variant,
    maxTurns,
  );
}

function buildInvestigationSystemPrompt(
  scenarioName: string,
  anchorTimeIso?: string,
  variant: PromptVariant = 'baseline',
  maxTurns?: number,
): string {
  const { traces, logs } = scenarioTables(scenarioName);
  const sharedSchema = '';
  //   `These follow the standard OpenTelemetry ClickHouse schema:
  // - traces have Timestamp DateTime64(9), TraceId, SpanId, ParentSpanId,
  //   ServiceName, SpanName, SpanKind, Duration (nanoseconds), StatusCode,
  //   StatusMessage, plus Map(String,String) columns ResourceAttributes and
  //   SpanAttributes.
  // - logs have Timestamp DateTime64(9), TraceId, SpanId, ServiceName,
  //   SeverityText, SeverityNumber, Body, plus Map(String,String) columns
  //   ResourceAttributes and LogAttributes.`;

  // When the harness anchors a run to a fixed past time, the agent must use
  // that anchor as "now" for any relative window in the user's prompt. Without
  // this, the model uses today's date and queries an empty future window.
  const anchorBlock = anchorTimeIso
    ? `\nFIXED CURRENT TIME: ${anchorTimeIso}
All "now", "recently", "in the last N minutes/hours" references in the user's
prompt are anchored to this timestamp. When you query, use absolute ISO
timestamps relative to this anchor — do NOT use today's wall-clock date.
${SAMPLING_CAVEAT_BLOCK}`
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

${playbookBlock}
TOOL ENVIRONMENT: Only MCP query tools and the Read tool are available.
There are NO shell, write, or search tools (Bash, Write, Edit, Glob, Grep,
etc.). The Read tool is restricted to your working directory — you can only
use it to read files that were saved there by oversized tool responses.
If a tool response is too large and gets saved to a file, use Read to
retrieve its contents. Do NOT ToolSearch for Bash or other file tools.
If the saved file is still too large for Read, re-run the query with
narrower filters or smaller limits.

TURN BUDGET: You have a limited number of tool calls. Manage them wisely:
- After ~${maxTurns ?? 15} tool calls, if you have identified a primary root cause with
  supporting evidence, write your final answer. You can note additional
  areas worth investigating without exhaustively querying them.
- Do not keep exploring tangential signals once you have a strong causal
  chain for the user's reported symptom.
- High log/error volume alone does not indicate relevance. Before
  investigating a service further, verify it is in the causal chain of
  the user's reported symptom — not just noisy in the same time window.

Investigate the user's question. In your final answer, identify:
- the specific service(s) and operation(s) involved
- the root cause (or, for cleanup-style questions, the top concrete actions)
- supporting evidence from the data (counts, time ranges, sample messages)
- a brief "What's not the cause" section that explicitly names any
  investigated signals you ruled out and why — this helps the reader
  trust your conclusion

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
