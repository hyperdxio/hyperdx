import type { LogRow, TraceRow } from '@/generators/types';
import type { ToolCallRecord } from '@/harness/types';
import type { SeededRng } from '@/rng/seeded';

export type GenerateContext = {
  rng: SeededRng;
  nowMs: number;
  /**
   * Test-only override. Scenarios should multiply background counts by this
   * factor. Planted anomaly counts (the diagnostic signal) stay fixed so
   * structural invariants still hold at low volume. Default 1.
   */
  volumeFactor?: number;
  /**
   * Rows per batch for streaming generation. Default 10_000. Tests can pass
   * a larger value to reduce overhead when collecting.
   */
  batchSize?: number;
};

export type ScenarioBatch = {
  traces: TraceRow[];
  logs: LogRow[];
};

// ─── Scenario hooks ──────────────────────────────────────────────────────────
// These optional hooks let scenarios customize harness and grading behavior
// without requiring changes to framework files. A new scenario kind (e.g.,
// alert-build, saved-search-build) only needs to implement the relevant hooks
// in its generate.ts — no changes to cli.ts, grade.ts, settingsFile.ts, etc.

/**
 * Context passed to the system prompt builder hook.
 */
export type SystemPromptContext = {
  /** Scenario-specific ClickHouse table names. */
  tables: { traces: string; logs: string };
  /** Fixed anchor time ISO string (if set). */
  anchorTimeIso?: string;
  /** Max tool turns for the run. */
  maxTurns?: number;
};

/**
 * Result of a post-run inspection hook. The `evidence` string is appended
 * to the judge prompt so the LLM judge can evaluate the actual artifact
 * (dashboard, alert, saved search, etc.) — not just the agent's text answer.
 */
export type PostRunInspectionResult = {
  /** Human-readable evidence string appended to the judge prompt. */
  evidence: string;
  /** Structured summary persisted in the grade record. */
  summary: Record<string, unknown>;
  /** Dashboard (or other artifact) IDs to clean up after grading. */
  cleanupIds?: string[];
};

/**
 * Context passed to the post-run inspection hook.
 */
export type PostRunInspectionContext = {
  toolCalls: ToolCallRecord[];
  apiUrl: string;
  accessKey: string;
  email: string;
  password: string;
  anchorTimeIso?: string;
  cleanup?: boolean;
};

export type Scenario = {
  name: string;
  agentPrompt: string;
  description: string;
  /**
   * Yields batches of rows for insertion. Implementations should respect
   * `ctx.batchSize` (cap per-yield row count) and `ctx.volumeFactor`
   * (scale background volumes — planted anomalies stay constant).
   */
  generate(ctx: GenerateContext): Iterable<ScenarioBatch>;
  groundTruth: Record<string, unknown>;

  // ─── Optional hooks ──────────────────────────────────────────────
  // Scenarios that don't provide these hooks get the default investigation
  // behavior — no framework changes needed.

  /**
   * Custom system prompt builder. When provided, replaces the default
   * SRE-investigation system prompt entirely. This is how non-investigation
   * scenarios (dashboard-build, alert-build, etc.) inject their own
   * instructions without modifying systemPrompt.ts.
   */
  buildSystemPrompt?: (ctx: SystemPromptContext) => string;

  /**
   * Tool name substrings to remove from the denied-tools list. Lets
   * scenarios selectively unblock tools (e.g., dashboard tools) without
   * modifying settingsFile.ts. Matched via substring against each
   * denied tool name.
   */
  allowedToolPatterns?: string[];

  /**
   * LLM judge system preamble override. When provided, replaces the
   * default "evaluating an SRE investigation" preamble. The scenario
   * can instruct the judge to evaluate artifacts (dashboards, alerts)
   * rather than text answers.
   */
  judgeSystemPreamble?: string;

  /**
   * Post-run inspection hook. Runs after the agent completes but before
   * grading. Can inspect the created artifacts (dashboards, alerts, etc.)
   * via the API, collect evidence for the judge, and clean up.
   *
   * When this hook is provided AND returns evidence, the grading pipeline:
   *  1. Passes the evidence string to the LLM judge prompt
   *  2. Persists the summary in the grade record
   *  3. Cleans up artifacts listed in cleanupIds
   */
  postRunInspection?: (
    ctx: PostRunInspectionContext,
  ) => Promise<PostRunInspectionResult>;
};

/** Helper for tests: drain an iterable into one combined batch. */
export function collectScenario(iter: Iterable<ScenarioBatch>): ScenarioBatch {
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  for (const b of iter) {
    if (b.traces.length) traces.push(...b.traces);
    if (b.logs.length) logs.push(...b.logs);
  }
  return { traces, logs };
}
