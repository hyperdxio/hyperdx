import type { GradeRecord } from '../grading/types';
import type { McpKind, RunRecord } from '../harness/types';
import { modelDirName } from '../runs/path';

/**
 * A column key uniquely identifies a (mcp, model) combination in reports.
 * When a batch has a single model, the column key equals the MCP name
 * (backward-compatible). When multiple models are present, the column
 * key is `mcp/model`.
 */
export type ColumnKey = string;

export type CellSummary = {
  scenario: string;
  mcp: McpKind;
  model: string;
  /** Display key used in report columns. */
  columnKey: ColumnKey;
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
  /** Cells keyed by column key (mcp or mcp/model). */
  cells: Record<ColumnKey, CellSummary>;
  /** Which column key is the baseline. */
  baseline?: ColumnKey;
  /** Per-challenger deltas vs the baseline. Keyed by challenger column key. */
  deltas: Record<ColumnKey, DeltaSummary>;
};

export type BatchSummary = {
  batchDir: string;
  generatedAt: string;
  /** The baseline column key used for delta computation. */
  baseline?: ColumnKey;
  /** Ordered list of column keys as they appear in the report columns. */
  columnOrder: ColumnKey[];
  /** Whether this batch compares multiple models. */
  multiModel: boolean;
  scenarios: ScenarioSummary[];
  /**
   * @deprecated Use `columnOrder`. Preserved for backward compatibility
   * with older viewer code.
   */
  mcpOrder: ColumnKey[];
};

export type GradedRunPair = {
  run: RunRecord;
  grade: GradeRecord;
};

/**
 * Build a column key from a (mcp, model) pair.
 * When `multiModel` is false the column key is just the mcp name.
 *
 * The model component is sanitized through `modelDirName` so that the
 * column key matches the directory name on disk (which is what the
 * viewer reads). Without this, model IDs containing `/`, `:`, or `.`
 * would produce different keys in the summary JSON vs the viewer.
 */
export function columnKeyFor(
  mcp: McpKind,
  model: string,
  multiModel: boolean,
): ColumnKey {
  return multiModel ? `${mcp}/${modelDirName(model)}` : mcp;
}

export function buildAggregate(args: {
  batchDir: string;
  pairs: GradedRunPair[];
  /** Explicit baseline column key. If not set, the first column encountered
   *  is used. When using a single model, pass just the mcp name. */
  baseline?: ColumnKey;
}): BatchSummary {
  // Detect whether this batch involves multiple models.
  const modelSet = new Set<string>();
  for (const p of args.pairs) modelSet.add(p.run.model);
  const multiModel = modelSet.size > 1;

  const byScenario = new Map<string, GradedRunPair[]>();
  const columnSet = new Set<ColumnKey>();
  for (const p of args.pairs) {
    if (!byScenario.has(p.run.scenario)) byScenario.set(p.run.scenario, []);
    byScenario.get(p.run.scenario)!.push(p);
    columnSet.add(columnKeyFor(p.run.mcp, p.run.model, multiModel));
  }
  const columnOrder = [...columnSet].sort();
  const baseline = args.baseline ?? columnOrder[0];

  const scenarios: ScenarioSummary[] = [];
  for (const [name, ps] of byScenario.entries()) {
    const byCol = new Map<ColumnKey, GradedRunPair[]>();
    for (const p of ps) {
      const key = columnKeyFor(p.run.mcp, p.run.model, multiModel);
      if (!byCol.has(key)) byCol.set(key, []);
      byCol.get(key)!.push(p);
    }
    const cells: Record<ColumnKey, CellSummary> = {};
    for (const [col, list] of byCol.entries()) {
      const first = list[0].run;
      cells[col] = buildCellSummary(name, first.mcp, first.model, col, list);
    }

    // Compute deltas: each non-baseline column vs the baseline.
    const deltas: Record<ColumnKey, DeltaSummary> = {};
    const baselineCell = cells[baseline];
    for (const col of Object.keys(cells)) {
      if (col === baseline) continue;
      deltas[col] = computeDelta(cells[col], baselineCell);
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
    columnOrder,
    multiModel,
    mcpOrder: columnOrder,
    scenarios,
  };
}

function buildCellSummary(
  scenario: string,
  mcp: McpKind,
  model: string,
  columnKey: ColumnKey,
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
    model,
    columnKey,
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
