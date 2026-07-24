import type { BatchSummary, CellSummary } from './aggregate';

/**
 * M1 CI-skeleton verdict.
 *
 * For Milestone 1 the goal is only to prove the pipeline runs end to end in
 * GitHub Actions — Setup → Seed → Run → Grade → Report — not to gate merges on
 * eval quality. So the verdict is intentionally **completion-only**: it passes
 * when the batch produced at least one graded run that reached a final answer
 * (i.e. every stage ran to completion and emitted output), regardless of the
 * combined score. Score-based gating is deferred to a later milestone.
 */

export type EvalVerdict = {
  /** Overall pass/fail. Completion-only for M1. */
  pass: boolean;
  /** One-line human-readable reason. */
  reason: string;
  /** Total number of graded runs aggregated in the batch. */
  totalRuns: number;
  /** Runs whose termination was a clean final answer. */
  completedRuns: number;
  /** Per-scenario roll-up used to render the summary table. */
  scenarios: VerdictScenario[];
};

type VerdictScenario = {
  scenario: string;
  /** Column keys (mcp / mcp+model / …) present for this scenario. */
  columns: string[];
  /** Total graded runs across all columns. */
  runs: number;
  /** Runs that reached a final answer. */
  completed: number;
  /** Mean combined score across columns (informational only in M1). */
  combinedScore: number | null;
};

/** Termination kinds that count as "ran to completion and produced output". */
const COMPLETION_TERMINATIONS = new Set(['final_answer']);

function completedFromTermination(rec: Record<string, number>): number {
  let n = 0;
  for (const [kind, count] of Object.entries(rec)) {
    if (COMPLETION_TERMINATIONS.has(kind)) n += count;
  }
  return n;
}

function meanOrNull(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Compute the M1 completion-only verdict from an aggregated batch summary
 * (the `_summary.json` written by `report`).
 */
export function computeVerdict(summary: BatchSummary): EvalVerdict {
  const scenarios: VerdictScenario[] = [];
  let totalRuns = 0;
  let completedRuns = 0;

  for (const s of summary.scenarios) {
    const cells: CellSummary[] = Object.values(s.cells);
    let runs = 0;
    let completed = 0;
    const scores: number[] = [];
    for (const c of cells) {
      runs += c.n;
      completed += completedFromTermination(c.termination);
      scores.push(c.combinedScore.mean);
    }
    totalRuns += runs;
    completedRuns += completed;
    scenarios.push({
      scenario: s.scenario,
      columns: cells.map(c => c.columnKey).sort(),
      runs,
      completed,
      combinedScore: meanOrNull(scores),
    });
  }

  const pass = completedRuns > 0;
  const reason = pass
    ? `Pipeline ran end to end: ${completedRuns}/${totalRuns} run(s) reached a final answer across ${scenarios.length} scenario(s).`
    : totalRuns === 0
      ? 'No graded runs were produced — the pipeline did not complete.'
      : `No run reached a final answer (${totalRuns} run(s) ended early: timeout/max_turns/error).`;

  return { pass, reason, totalRuns, completedRuns, scenarios };
}

/**
 * Render the verdict as a compact Markdown block suitable for a PR comment.
 * Includes a stable HTML marker comment so the CI step can find-and-update
 * the existing comment on re-runs instead of posting duplicates.
 */
export function renderVerdictComment(
  verdict: EvalVerdict,
  opts: {
    /** Batch directory basename, shown for traceability. */
    batchLabel?: string;
    /** Link to the workflow run, appended when provided. */
    runUrl?: string;
    /** Commit SHA the evals ran against. */
    commitSha?: string;
  } = {},
): string {
  const badge = verdict.pass ? '✅ PASS' : '❌ FAIL';
  const lines: string[] = [];
  lines.push('<!-- hdx-eval-verdict -->');
  lines.push(`## MCP Eval Results — ${badge}`);
  lines.push('');
  lines.push(
    '_Advisory only (Milestone 1 CI skeleton) — this check does not block merges._',
  );
  lines.push('');
  lines.push(verdict.reason);
  lines.push('');

  if (verdict.scenarios.length > 0) {
    lines.push('| Scenario | Runs completed | Combined score |');
    lines.push('|---|---|---|');
    for (const s of verdict.scenarios) {
      const score =
        s.combinedScore === null
          ? '—'
          : `${(s.combinedScore * 100).toFixed(0)}%`;
      lines.push(`| ${s.scenario} | ${s.completed}/${s.runs} | ${score} |`);
    }
    lines.push('');
  }

  const meta: string[] = [];
  if (opts.batchLabel) meta.push(`Batch: \`${opts.batchLabel}\``);
  if (opts.commitSha) meta.push(`Commit: \`${opts.commitSha.slice(0, 7)}\``);
  if (opts.runUrl) meta.push(`[View workflow run →](${opts.runUrl})`);
  if (meta.length > 0) {
    lines.push(meta.join(' · '));
  }

  return lines.join('\n');
}
