import type { McpKind } from '@/harness/types';

export type ProgrammaticCheck = {
  id: string;
  weight: number;
  pattern: string;
  flags?: string;
  // When true, the check is satisfied when the pattern does NOT match the
  // answer. Used to penalize wrong attributions / blamed distractors.
  negative?: boolean;
};

/**
 * An adoption check detects metric engagement from tool-call **arguments**
 * alone: it is satisfied when some single tool call's input args name one of
 * the scenario's target metrics, regardless of which tool was called. This
 * keeps the grader arm-agnostic — a ClickStack metric tool naming
 * `jvm.gc.pause` and a raw SQL query filtering `MetricName = 'jvm.gc.pause'`
 * both count. Tool names and tool outputs are never matched.
 */
export type AdoptionCheck = {
  id: string;
  /** Required (positive) unless `informational: true`; ignored for
   *  informational checks. */
  weight?: number;
  /**
   * Any-of list of full metric names/keys (e.g.
   * `process.runtime.jvm.memory.used`). Matched case-insensitively with
   * `.`/`_`-tolerant separators, so `jvm_gc_pause` also counts.
   */
  metrics: string[];
  /**
   * Optional extra regex that must ALSO match the same call's args (e.g.
   * `pool|pod` for "grouped the memory metric by pod/pool").
   */
  alsoPattern?: string;
  /**
   * When true, the check is evaluated and reported (per-check usage rate)
   * but EXCLUDED from the weighted adoption score. Use for metrics whose
   * facts have cheaper substitutes in other signals — querying them is
   * thoroughness, not the behavior the score measures, and an efficient
   * agent that skips them should still read 100%.
   */
  informational?: boolean;
};

type JudgeCriterion = {
  id: string;
  weight: number;
  description: string;
};

export type Rubric = {
  programmatic: ProgrammaticCheck[];
  /**
   * Optional metric-adoption checks, run against the input args of each
   * tool call (never tool names, outputs, or the prompt). Absent ⇒ the
   * scenario has no adoption grading.
   */
  adoption?: AdoptionCheck[];
  judge: { criteria: JudgeCriterion[] };
};

export type ProgrammaticHit = {
  id: string;
  weight: number;
  matched: boolean;
  satisfied: boolean;
  negative?: boolean;
  /** Present (true) on adoption hits whose check is informational —
   *  reported but excluded from the score. */
  informational?: boolean;
};

export type ProgrammaticResult = {
  hits: ProgrammaticHit[];
  score: number; // 0..1
};

export type JudgeCriterionScore = {
  score: number; // 0..5
  rationale: string;
};

export type JudgeResult = {
  model: string;
  scores: Record<string, JudgeCriterionScore>;
  weightedScore: number; // 0..1, sum(score*weight) / (5*sum(weight))
  rawResponse: string;
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  error?: string;
};

/**
 * Per-run tool-error stats — computed from the saved RunRecord, not the
 * agent's answer. Bad runs (lots of failed tool calls) get a combined-score
 * penalty even if the final answer happens to be correct.
 */
export type ToolErrorStats = {
  /** Total tool calls observed. */
  total: number;
  /** Tool calls flagged isError by the harness/MCP. */
  errors: number;
  /** errors / total (0 when total = 0). */
  rate: number;
  /** Penalty applied to combinedScore: clamp(rate, 0, MAX_ERROR_PENALTY). */
  penalty: number;
  /** First few error tool names + a short snippet of the error text. */
  samples: Array<{ name: string; preview: string }>;
};

export type GradeRecord = {
  schemaVersion: 2;
  runId: string;
  scenario: string;
  mcp: McpKind;
  programmatic: ProgrammaticResult;
  /**
   * Metric-adoption check results, when the scenario rubric defines an
   * `adoption` block. Absent when the rubric has no `adoption` block.
   */
  adoption?: ProgrammaticResult;
  judge: JudgeResult | null;
  toolErrors: ToolErrorStats;
  /**
   * Scenario-specific inspection summary. Only present when the scenario
   * provides a `postRunInspection` hook. The shape depends on the scenario
   * (e.g., dashboard scenarios include tile details, alert scenarios might
   * include alert evaluation results). Persisted as opaque JSON.
   */
  inspectionSummary?: Record<string, unknown>;
  /**
   * Human-readable inspection evidence that was passed to the LLM judge.
   * Persisted so re-grades (e.g. --rerun-judge) can reuse the evidence
   * without re-running the inspection hook (artifacts may be cleaned up).
   */
  inspectionEvidence?: string;
  /**
   * combinedScore = clamp01(
   *   PROGRAMMATIC_WEIGHT * programmatic + JUDGE_WEIGHT * judge
   *     - toolErrors.penalty
   * )
   * When a postRunInspection hook provides evidence, the judge receives
   * it alongside the ground truth — the judge score already incorporates
   * artifact quality, so no separate mechanical blend is needed.
   */
  combinedScore: number;
  gradedAt: string;
  judgeModel: string;
};

export const COMBINED_SCORE_PROGRAMMATIC_WEIGHT = 0.4;
export const COMBINED_SCORE_JUDGE_WEIGHT = 0.6;
/** Maximum penalty applied for tool errors (subtracted from combined score). */
export const MAX_ERROR_PENALTY = 0.2;
