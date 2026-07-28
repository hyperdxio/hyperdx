import type { GradeRecord } from '@/grading/types';
import { type McpKind, PLUGIN_NONE, type RunRecord } from '@/harness/types';
import { escapeDirSegment } from '@/runs/path';

/**
 * A column key uniquely identifies a (mcp, model, plugin) combination in
 * reports. The MCP name is always the base; when the batch compares multiple
 * models and/or plugins, the varying components are appended after a `/`,
 * joined with `+`: `mcp`, `mcp/model`, `mcp/plugin`, or `mcp/model+plugin`.
 */
export type ColumnKey = string;

export type CellSummary = {
  scenario: string;
  mcp: McpKind;
  model: string;
  plugin: string;
  /** Display key used in report columns. */
  columnKey: ColumnKey;
  n: number;
  programmatic: { mean: number; perCheck: Record<string, number> };
  adoption?: { mean: number; perCheck: Record<string, number> };
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
  /** Adoption-score delta; present only when both cells have adoption. */
  adoptionScore?: number | null;
};

export type ScenarioSummary = {
  scenario: string;
  /** Cells keyed by column key (e.g. mcp, mcp/model, mcp/model+plugin). */
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
  /** Whether this batch compares multiple plugin arms. */
  multiPlugin: boolean;
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
 * Build a column key from a (mcp, model, plugin) tuple.
 * The MCP name is always the base. Model and plugin follow the same rule:
 * a component is included only when the batch compares multiple values of
 * that dimension. Varying components are appended after a `/`, joined with
 * `+` (e.g. `hyperdx/opus`, `hyperdx/myplugin`, `hyperdx/opus+myplugin`).
 * When plugins vary, the no-plugin variant renders as the literal `none`.
 *
 * The model/plugin components are sanitized through `escapeDirSegment` so the
 * column key matches the directory name on disk (which is what the viewer
 * reads).
 */
export function columnKeyFor(
  mcp: McpKind,
  model: string,
  plugin: string,
  opts: { multiModel: boolean; multiPlugin: boolean },
): ColumnKey {
  const varying: string[] = [];
  if (opts.multiModel) varying.push(escapeDirSegment(model));
  if (opts.multiPlugin) varying.push(escapeDirSegment(plugin || PLUGIN_NONE));
  return varying.length > 0 ? `${mcp}/${varying.join('+')}` : mcp;
}

export function buildAggregate(args: {
  batchDir: string;
  pairs: GradedRunPair[];
  /** Explicit baseline column key. Ignored when it doesn't match any column
   *  in the batch; without a (valid) baseline the first column is used.
   *  Callers that know the CLI variant order (the `run` command) or a
   *  previously persisted baseline (`writeBatchSummary`) pass it here. */
  baseline?: ColumnKey;
}): BatchSummary {
  // Detect whether this batch compares multiple models / plugins.
  const modelSet = new Set<string>();
  const pluginSet = new Set<string>();
  for (const p of args.pairs) {
    modelSet.add(p.run.model);
    pluginSet.add(p.run.plugin ?? PLUGIN_NONE);
  }
  const multiModel = modelSet.size > 1;
  const multiPlugin = pluginSet.size > 1;
  const keyOpts = { multiModel, multiPlugin };

  const byScenario = new Map<string, GradedRunPair[]>();
  const columnSet = new Set<ColumnKey>();
  for (const p of args.pairs) {
    if (!byScenario.has(p.run.scenario)) byScenario.set(p.run.scenario, []);
    byScenario.get(p.run.scenario)!.push(p);
    columnSet.add(
      columnKeyFor(
        p.run.mcp,
        p.run.model,
        p.run.plugin ?? PLUGIN_NONE,
        keyOpts,
      ),
    );
  }
  const columnOrder = [...columnSet].sort();
  // Honor the requested baseline only if it actually matches a column (a
  // persisted baseline can go stale, e.g. after a key-format change);
  // otherwise fall back to the first column.
  const baseline =
    args.baseline && columnSet.has(args.baseline)
      ? args.baseline
      : columnOrder[0];

  const scenarios: ScenarioSummary[] = [];
  for (const [name, ps] of byScenario.entries()) {
    const byCol = new Map<ColumnKey, GradedRunPair[]>();
    for (const p of ps) {
      const key = columnKeyFor(
        p.run.mcp,
        p.run.model,
        p.run.plugin ?? PLUGIN_NONE,
        keyOpts,
      );
      if (!byCol.has(key)) byCol.set(key, []);
      byCol.get(key)!.push(p);
    }
    const cells: Record<ColumnKey, CellSummary> = {};
    for (const [col, list] of byCol.entries()) {
      const first = list[0].run;
      cells[col] = buildCellSummary(
        name,
        first.mcp,
        first.model,
        first.plugin ?? PLUGIN_NONE,
        col,
        list,
      );
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
    multiPlugin,
    mcpOrder: columnOrder,
    scenarios,
  };
}

function buildCellSummary(
  scenario: string,
  mcp: McpKind,
  model: string,
  plugin: string,
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

  // Adoption (transcript-aware tool usage). Only pairs whose grade carries an
  // `adoption` block contribute; the cell omits `adoption` entirely when the
  // scenario has no transcript rubric.
  const adopted = pairs.filter(p => p.grade.adoption);
  let adoption: CellSummary['adoption'];
  if (adopted.length > 0) {
    const adoptionMean = mean(adopted.map(p => p.grade.adoption!.score));
    const adoptionPerCheck: Record<string, number> = {};
    const adoptionCheckIds = new Set<string>();
    for (const p of adopted)
      for (const h of p.grade.adoption!.hits) adoptionCheckIds.add(h.id);
    for (const id of adoptionCheckIds) {
      const satisfied = adopted.map(
        p => p.grade.adoption!.hits.find(h => h.id === id)?.satisfied ?? false,
      );
      adoptionPerCheck[id] =
        satisfied.filter(Boolean).length / satisfied.length;
    }
    adoption = { mean: adoptionMean, perCheck: adoptionPerCheck };
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
    plugin,
    columnKey,
    n,
    programmatic: { mean: programmaticScore, perCheck },
    ...(adoption ? { adoption } : {}),
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
    ...(challenger.adoption && baseline.adoption
      ? { adoptionScore: challenger.adoption.mean - baseline.adoption.mean }
      : {}),
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
