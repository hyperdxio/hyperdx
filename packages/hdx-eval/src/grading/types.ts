import type { McpKind } from '../harness/types';

export type ProgrammaticCheck = {
  id: string;
  weight: number;
  pattern: string;
  flags?: string;
  // When true, the check is satisfied when the pattern does NOT match the
  // answer. Used to penalize wrong attributions / blamed distractors.
  negative?: boolean;
};

export type JudgeCriterion = {
  id: string;
  weight: number;
  description: string;
};

export type Rubric = {
  programmatic: ProgrammaticCheck[];
  judge: { criteria: JudgeCriterion[] };
};

export type ProgrammaticHit = {
  id: string;
  weight: number;
  matched: boolean;
  satisfied: boolean;
  negative?: boolean;
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
  judge: JudgeResult | null;
  toolErrors: ToolErrorStats;
  /**
   * combinedScore = clamp01(
   *   PROGRAMMATIC_WEIGHT * programmatic + JUDGE_WEIGHT * judge
   *     - toolErrors.penalty
   * )
   * The penalty is at most MAX_ERROR_PENALTY (0.2) — a run can't be reduced
   * to zero from a high error rate alone, but spamming bad tool calls makes
   * an otherwise-good answer measurably worse.
   */
  combinedScore: number;
  gradedAt: string;
  judgeModel: string;
};

export const COMBINED_SCORE_PROGRAMMATIC_WEIGHT = 0.4;
export const COMBINED_SCORE_JUDGE_WEIGHT = 0.6;
/** Maximum penalty applied for tool errors (subtracted from combined score). */
export const MAX_ERROR_PENALTY = 0.2;
