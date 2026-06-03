import type { GradeRecord } from '../grading/types';
import type { McpKind, RunRecord } from '../harness/types';

export type CellSummary = {
  scenario: string;
  mcp: McpKind;
  n: number;
  programmatic: { mean: number; perCheck: Record<string, number> };
  judge: {
    weightedMean: number;
    perCriterion: Record<string, number>;
    judged: number;
  };
  combinedScore: { mean: number };
  toolCalls: { mean: number };
  toolErrors: { mean: number; rateMean: number; penaltyMean: number };
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  durationMs: { mean: number };
  termination: Record<string, number>;
};

export type DeltaSummary = {
  combinedScore: number | null;
  programmaticScore: number | null;
  judgeWeightedMean: number | null;
  toolCalls: number | null;
  outputTokens: number | null;
  durationMs: number | null;
};

export type ScenarioSummary = {
  scenario: string;
  /** All MCP cells keyed by MCP name. */
  cells: Record<McpKind, CellSummary>;
  /** Which MCP is the baseline (first MCP, or explicitly set). */
  baseline?: McpKind;
  /** Per-challenger deltas vs the baseline. Keyed by challenger MCP name. */
  deltas: Record<McpKind, DeltaSummary>;
};

export type BatchSummary = {
  batchDir: string;
  generatedAt: string;
  /** The baseline MCP used for delta computation. */
  baseline?: McpKind;
  /** Ordered list of MCP names as they appear in the report columns. */
  mcpOrder: McpKind[];
  scenarios: ScenarioSummary[];
};

export type GradedRunPair = {
  run: RunRecord;
  grade: GradeRecord;
};

export function buildAggregate(args: {
  batchDir: string;
  pairs: GradedRunPair[];
  /** Explicit baseline MCP. If not set, the first MCP encountered is used. */
  baseline?: McpKind;
}): BatchSummary {
  const byScenario = new Map<string, GradedRunPair[]>();
  // Track all MCP names in insertion order.
  const mcpSet = new Set<McpKind>();
  for (const p of args.pairs) {
    if (!byScenario.has(p.run.scenario)) byScenario.set(p.run.scenario, []);
    byScenario.get(p.run.scenario)!.push(p);
    mcpSet.add(p.run.mcp);
  }
  const mcpOrder = [...mcpSet].sort();
  const baseline = args.baseline ?? mcpOrder[0];

  const scenarios: ScenarioSummary[] = [];
  for (const [name, ps] of byScenario.entries()) {
    const byMcp = new Map<McpKind, GradedRunPair[]>();
    for (const p of ps) {
      if (!byMcp.has(p.run.mcp)) byMcp.set(p.run.mcp, []);
      byMcp.get(p.run.mcp)!.push(p);
    }
    const cells: Record<McpKind, CellSummary> = {};
    for (const [mcp, list] of byMcp.entries()) {
      cells[mcp] = buildCellSummary(name, mcp, list);
    }

    // Compute deltas: each non-baseline MCP vs the baseline.
    const deltas: Record<McpKind, DeltaSummary> = {};
    const baselineCell = cells[baseline];
    for (const mcp of Object.keys(cells)) {
      if (mcp === baseline) continue;
      deltas[mcp] = computeDelta(cells[mcp], baselineCell);
    }

    scenarios.push({
      scenario: name,
      cells,
      baseline,
      deltas,
    });
  }

  scenarios.sort((a, b) => a.scenario.localeCompare(b.scenario));
  return {
    batchDir: args.batchDir,
    generatedAt: new Date().toISOString(),
    baseline,
    mcpOrder,
    scenarios,
  };
}

function buildCellSummary(
  scenario: string,
  mcp: McpKind,
  pairs: GradedRunPair[],
): CellSummary {
  const n = pairs.length;
  const programmaticScore = mean(pairs.map(p => p.grade.programmatic.score));

  const judgeable = pairs.filter(p => p.grade.judge);
  const judgeMean =
    judgeable.length === 0
      ? 0
      : mean(judgeable.map(p => p.grade.judge!.weightedScore));

  const combinedMean = mean(pairs.map(p => p.grade.combinedScore));
  const toolCallsMean = mean(pairs.map(p => p.run.toolCalls.length));
  const toolErrorsMean = mean(pairs.map(p => p.grade.toolErrors?.errors ?? 0));
  const toolErrorRateMean = mean(pairs.map(p => p.grade.toolErrors?.rate ?? 0));
  const toolErrorPenaltyMean = mean(
    pairs.map(p => p.grade.toolErrors?.penalty ?? 0),
  );
  const durationMean = mean(pairs.map(p => p.run.durationMs));

  const tokens = {
    input: mean(pairs.map(p => p.run.tokens.input)),
    output: mean(pairs.map(p => p.run.tokens.output)),
    cacheRead: mean(pairs.map(p => p.run.tokens.cacheRead)),
    cacheCreation: mean(pairs.map(p => p.run.tokens.cacheCreation)),
  };

  const perCheck: Record<string, number> = {};
  if (pairs.length > 0) {
    const checkIds = new Set<string>();
    for (const p of pairs)
      for (const h of p.grade.programmatic.hits) checkIds.add(h.id);
    for (const id of checkIds) {
      const satisfiedHits = pairs.map(
        p =>
          p.grade.programmatic.hits.find(h => h.id === id)?.satisfied ?? false,
      );
      perCheck[id] =
        satisfiedHits.filter(Boolean).length / satisfiedHits.length;
    }
  }

  const perCriterion: Record<string, number> = {};
  if (judgeable.length > 0) {
    const critIds = new Set<string>();
    for (const p of judgeable)
      for (const k of Object.keys(p.grade.judge!.scores)) critIds.add(k);
    for (const id of critIds) {
      const scores = judgeable
        .map(p => p.grade.judge!.scores[id]?.score)
        .filter((s): s is number => typeof s === 'number');
      if (scores.length > 0) perCriterion[id] = mean(scores);
    }
  }

  const termination: Record<string, number> = {};
  for (const p of pairs) {
    termination[p.run.termination] = (termination[p.run.termination] ?? 0) + 1;
  }

  return {
    scenario,
    mcp,
    n,
    programmatic: { mean: programmaticScore, perCheck },
    judge: {
      weightedMean: judgeMean,
      perCriterion,
      judged: judgeable.length,
    },
    combinedScore: { mean: combinedMean },
    toolCalls: { mean: toolCallsMean },
    toolErrors: {
      mean: toolErrorsMean,
      rateMean: toolErrorRateMean,
      penaltyMean: toolErrorPenaltyMean,
    },
    tokens,
    durationMs: { mean: durationMean },
    termination,
  };
}

/**
 * Compute the delta between a challenger and the baseline.
 * Delta = challenger − baseline.
 */
function computeDelta(
  challenger: CellSummary | undefined,
  baseline: CellSummary | undefined,
): DeltaSummary {
  if (!challenger || !baseline) {
    return {
      combinedScore: null,
      programmaticScore: null,
      judgeWeightedMean: null,
      toolCalls: null,
      outputTokens: null,
      durationMs: null,
    };
  }
  return {
    combinedScore: challenger.combinedScore.mean - baseline.combinedScore.mean,
    programmaticScore:
      challenger.programmatic.mean - baseline.programmatic.mean,
    judgeWeightedMean:
      challenger.judge.weightedMean - baseline.judge.weightedMean,
    toolCalls: challenger.toolCalls.mean - baseline.toolCalls.mean,
    outputTokens: challenger.tokens.output - baseline.tokens.output,
    durationMs: challenger.durationMs.mean - baseline.durationMs.mean,
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
