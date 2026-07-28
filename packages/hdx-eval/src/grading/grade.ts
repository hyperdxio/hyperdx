import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { PLUGIN_NONE, type RunRecord } from '@/harness/types';
import { columnKeyFor } from '@/reports/aggregate';
import { getRunFilesInBatch, runsRoot } from '@/runs/path';
import { readRun } from '@/runs/store';
import { getScenario, SCENARIO_NAMES } from '@/scenarios';
import type { PostRunInspectionResult } from '@/scenarios/types';

import type { BlindingEntry } from './blind';
import { judgeTrajectory } from './judge';
import {
  DEFAULT_JUDGE_SPEC,
  judgeCredentialsAvailable,
  parseJudgeSpec,
} from './judgeModel';
import { runProgrammaticChecks, runTranscriptChecks } from './programmatic';
import { loadScenarioRubric } from './rubric';
import {
  COMBINED_SCORE_JUDGE_WEIGHT,
  COMBINED_SCORE_PROGRAMMATIC_WEIGHT,
  type GradeRecord,
  type JudgeResult,
  MAX_ERROR_PENALTY,
  type ToolErrorStats,
} from './types';

// Infrastructure-error patterns that come from the MCP/CH server itself
// rather than from agent mistakes. We exclude these from the tool-error
// penalty so a server hiccup doesn't get charged against the agent.
const INFRA_ERROR_PATTERNS: RegExp[] = [
  /too many simultaneous queries/i,
  /stream has been already consumed/i,
  /rate.?limit/i,
  /429/,
  /503\b/,
  /504\b/,
  /econn(refused|reset|aborted)/i,
  /socket hang up/i,
  /timeout.{0,20}(connecting|while waiting)/i,
];

function isInfraError(text: string): boolean {
  return INFRA_ERROR_PATTERNS.some(rx => rx.test(text));
}

function computeToolErrorStats(record: RunRecord): ToolErrorStats {
  const total = record.toolCalls.length;
  const errored = record.toolCalls.filter(c => c.isError);
  // Separate agent-attributable errors from infrastructure failures (rate
  // limits, server-side bugs, transient 5xx). Only agent errors feed the
  // penalty — the agent has no control over server hiccups.
  const agentErrored = errored.filter(c => {
    const text =
      typeof c.output === 'string' ? c.output : JSON.stringify(c.output ?? '');
    return !isInfraError(text);
  });
  const errors = agentErrored.length;
  const rate = total > 0 ? errors / total : 0;
  // Linear penalty up to MAX_ERROR_PENALTY when ALL tool calls fail.
  // Mathematically: penalty = min(rate, MAX_ERROR_PENALTY).
  // We intentionally use rate (not errors/maxTurns) so a run that calls
  // 1 tool which fails (rate=1.0) is penalized as harshly as a run that
  // fails 20 of 20 tool calls — both are equally broken sessions.
  const penalty = Math.min(rate, MAX_ERROR_PENALTY);
  const samples = agentErrored.slice(0, 3).map(c => {
    const text =
      typeof c.output === 'string' ? c.output : JSON.stringify(c.output ?? '');
    return {
      name: c.name,
      preview: text.length > 160 ? text.slice(0, 160) + '…' : text,
    };
  });
  return { total, errors, rate, penalty, samples };
}

export type GradeBatchOptions = {
  /**
   * Judge model spec in `provider:model` form (e.g. `openai:gpt-4o`). A bare
   * model name defaults to the anthropic provider. Defaults to the built-in
   * {@link DEFAULT_JUDGE_SPEC}.
   */
  judgeModel?: string;
  rerunJudge?: boolean;
  skipJudge?: boolean;
  /** Blinding entries for anonymizing MCP identity during judging. */
  blindingEntries?: BlindingEntry[];
  /**
   * API config for post-run inspection hooks. When provided, scenarios
   * with a `postRunInspection` hook will receive this config so they
   * can call the HyperDX API to inspect artifacts.
   */
  inspectionConfig?: {
    apiUrl: string;
    accessKey: string;
    email: string;
    password: string;
    anchorTimeIso?: string;
    cleanup?: boolean;
  };
};

export type GradeBatchSummary = {
  batchDir: string;
  graded: GradeRecord[];
  errors: { runPath: string; error: string }[];
};

export async function gradeBatch(
  batchDir: string,
  opts: GradeBatchOptions = {},
): Promise<GradeBatchSummary> {
  const resolved = resolveBatchDir(batchDir);
  if (!existsSync(resolved)) {
    throw new Error(`Batch directory does not exist: ${resolved}`);
  }
  const runFiles = listRunFiles(resolved);

  // Detect whether this batch varies models/plugins so the per-run log labels
  // use the same column keys as the run output (e.g. `hyperdx/none/0`).
  const models = new Set<string>();
  const plugins = new Set<string>();
  for (const p of runFiles) {
    try {
      const r = readRun(p);
      models.add(r.model);
      plugins.add(r.plugin ?? PLUGIN_NONE);
    } catch {
      // Unreadable runs are reported by the grading loop below.
    }
  }
  const keyOpts = {
    multiModel: models.size > 1,
    multiPlugin: plugins.size > 1,
  };

  // Resolve the judge spec once so the credential check and the per-run judge
  // calls agree on which provider/model will be used.
  const judgeSpec = parseJudgeSpec(opts.judgeModel ?? DEFAULT_JUDGE_SPEC).spec;

  // Decide whether we'll actually need the judge: skipJudge wins, otherwise
  // we need it if any run is missing a cached judge OR rerun was requested.
  const needsJudge =
    !opts.skipJudge &&
    runFiles.some(p => {
      if (opts.rerunJudge) return true;
      const existing = readExistingGrade(gradeFilePath(p));
      // Re-judge if there's no cached judge, OR the cache came from a
      // DIFFERENT judge model. Keying on judge identity (not mere presence)
      // is what lets a judge-swap — e.g. re-grading an Opus-graded batch with
      // `openai:gpt-5.6-sol` — actually re-run instead of silently returning
      // the previous judge's stale scores.
      return !existing?.judge || existing.judgeModel !== judgeSpec;
    });

  if (needsJudge && !judgeCredentialsAvailable(judgeSpec)) {
    const { provider } = parseJudgeSpec(judgeSpec);
    const keyHint =
      provider === 'openai'
        ? 'AI_API_KEY or OPENAI_API_KEY'
        : 'AI_API_KEY or ANTHROPIC_API_KEY';
    throw new Error(
      `No API key set for the "${provider}" judge (${judgeSpec}); set ` +
        `${keyHint}, or pass --no-judge to skip the LLM judge.`,
    );
  }

  const graded: GradeRecord[] = [];
  const errors: { runPath: string; error: string }[] = [];

  for (const runPath of runFiles) {
    try {
      const record = readRun(runPath);
      const gradePath = gradeFilePath(runPath);
      const existing = readExistingGrade(gradePath);

      const grade = await gradeOne({
        record,
        judgeSpec,
        needsJudge,
        existing,
        opts,
      });
      writeGradeFile(gradePath, grade);
      graded.push(grade);
      const judgeBit = grade.judge
        ? `judge=${(grade.judge.weightedScore * 5).toFixed(1)}/5`
        : 'judge=skipped';
      const errBit = grade.toolErrors.errors
        ? `  errs=${grade.toolErrors.errors}/${grade.toolErrors.total}` +
          (grade.toolErrors.penalty > 0
            ? ` (-${(grade.toolErrors.penalty * 100).toFixed(0)}pp)`
            : '')
        : '';
      const adoptBit = grade.adoption
        ? `  adopt=${(grade.adoption.score * 100).toFixed(0)}%`
        : '';
      // Show inspection summary if present.
      const inspBit = grade.inspectionSummary
        ? formatInspectionLogBit(grade.inspectionSummary)
        : '';
      const cellLabel = columnKeyFor(
        record.mcp,
        record.model,
        record.plugin ?? PLUGIN_NONE,
        keyOpts,
      );
      console.log(
        `  ${grade.scenario}/${cellLabel}/${grade.runId.split('-').slice(-1)[0]}  prog=${(
          grade.programmatic.score * 100
        ).toFixed(
          0,
        )}%  ${judgeBit}  combined=${(grade.combinedScore * 100).toFixed(0)}%${adoptBit}${errBit}${inspBit}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ runPath, error: msg });
      console.error(`  ${runPath}: ${msg}`);
    }
  }

  return { batchDir: resolved, graded, errors };
}

function formatInspectionLogBit(summary: Record<string, unknown>): string {
  const parts: string[] = [];
  if (
    typeof summary.totalTiles === 'number' &&
    typeof summary.tilesWithData === 'number'
  ) {
    parts.push(`tiles=${summary.tilesWithData}/${summary.totalTiles}`);
  }
  if (typeof summary.createCalls === 'number') {
    parts.push(`creates=${summary.createCalls}`);
  }
  if (typeof summary.patchCalls === 'number') {
    parts.push(`patches=${summary.patchCalls}`);
  }
  return parts.length > 0 ? `  ${parts.join('  ')}` : '';
}

async function gradeOne(args: {
  record: RunRecord;
  /** Fully-qualified `provider:model` judge spec. */
  judgeSpec: string;
  /** Whether the batch resolved a usable judge (credentials present). */
  needsJudge: boolean;
  existing: GradeRecord | null;
  opts: GradeBatchOptions;
}): Promise<GradeRecord> {
  const { record, judgeSpec, needsJudge, existing, opts } = args;
  const scenario = getScenario(record.scenario);
  const rubric = loadScenarioRubric(record.scenario);

  const programmatic = runProgrammaticChecks(
    record.finalAnswer,
    rubric.programmatic,
  );

  // Transcript-aware (adoption) checks. Reported alongside the outcome score
  // but intentionally EXCLUDED from combinedScore below — measuring tool
  // usage must not inflate outcome quality.
  const adoption = rubric.transcript
    ? runTranscriptChecks(record.toolCalls, rubric.transcript)
    : undefined;

  const toolErrors = computeToolErrorStats(record);

  // ── Post-run inspection (scenario hook) ──────────────────────────
  // Runs BEFORE the judge so evidence can be passed to the judge prompt.
  // On re-grade, reuse the cached inspectionSummary from the existing
  // grade record — the artifacts were likely cleaned up on the first pass,
  // so re-running the hook would fail or produce empty evidence.
  let inspectionResult: PostRunInspectionResult | undefined;

  if (existing?.inspectionSummary) {
    // Reuse cached inspection from previous grading pass. The artifacts
    // were likely cleaned up, so re-running the hook would fail. The
    // persisted evidence string lets --rerun-judge work without re-inspection.
    inspectionResult = {
      evidence: existing.inspectionEvidence ?? '',
      summary: existing.inspectionSummary,
    };
  } else if (scenario.postRunInspection && opts.inspectionConfig) {
    try {
      inspectionResult = await scenario.postRunInspection({
        toolCalls: record.toolCalls,
        apiUrl: opts.inspectionConfig.apiUrl,
        accessKey: opts.inspectionConfig.accessKey,
        email: opts.inspectionConfig.email,
        password: opts.inspectionConfig.password,
        anchorTimeIso: opts.inspectionConfig.anchorTimeIso,
        cleanup: opts.inspectionConfig.cleanup ?? true,
      });
    } catch (err) {
      console.warn(
        `  post-run inspection failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ── LLM Judge ────────────────────────────────────────────────────
  // Only reuse the cached judge when it came from the SAME judge model as the
  // one requested this pass. A grade from a different judge (e.g. a prior Opus
  // pass when we're now grading with `openai:gpt-5.6-sol`) is treated as stale
  // so the requested judge actually runs — mirrors the batch-level needsJudge
  // check above. Inspection evidence is still reused from `existing` regardless
  // of judge (handled above), since re-inspecting after artifact cleanup would
  // fail.
  const cachedJudge =
    existing?.judge && existing.judgeModel === judgeSpec
      ? existing.judge
      : null;
  let judge: JudgeResult | null = cachedJudge;
  if (!opts.skipJudge && needsJudge && (!judge || opts.rerunJudge)) {
    judge = await judgeTrajectory({
      scenarioName: scenario.name,
      scenarioPrompt: scenario.agentPrompt,
      groundTruth: scenario.groundTruth,
      rubric,
      finalAnswer: record.finalAnswer,
      judgeModel: judgeSpec,
      blindingEntries: opts.blindingEntries,
      judgeSystemPreamble: scenario.judgeSystemPreamble,
      inspectionEvidence: inspectionResult?.evidence,
    });
  }

  // ── Combined score ───────────────────────────────────────────────
  const judgeError = judge && 'error' in judge && judge.error;
  const judgeScore = judge?.weightedScore ?? 0;
  const rawCombined =
    judge && !judgeError
      ? COMBINED_SCORE_PROGRAMMATIC_WEIGHT * programmatic.score +
        COMBINED_SCORE_JUDGE_WEIGHT * judgeScore
      : programmatic.score;

  // Apply the tool-error penalty AFTER scoring the answer. Clamp to [0,1].
  const combinedScore = Math.max(
    0,
    Math.min(1, rawCombined - toolErrors.penalty),
  );

  return {
    schemaVersion: 2,
    runId: record.runId,
    scenario: record.scenario,
    mcp: record.mcp,
    programmatic,
    ...(adoption ? { adoption } : {}),
    judge,
    toolErrors,
    inspectionSummary: inspectionResult?.summary,
    inspectionEvidence: inspectionResult?.evidence || undefined,
    combinedScore,
    gradedAt: new Date().toISOString(),
    judgeModel: judge?.model ?? (opts.skipJudge ? 'skipped' : judgeSpec),
  };
}

/** List run JSON files. See `getRunFilesInBatch` for the supported layouts. */
function listRunFiles(batchDir: string): string[] {
  return getRunFilesInBatch(batchDir, {
    scenarioFilter: s => SCENARIO_NAMES.includes(s),
  });
}

function readExistingGrade(path: string): GradeRecord | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GradeRecord;
  } catch {
    return null;
  }
}

function writeGradeFile(path: string, grade: GradeRecord): void {
  writeFileSync(path, JSON.stringify(grade, null, 2) + '\n', 'utf8');
}

function gradeFilePath(runPath: string): string {
  return runPath.replace(/\.json$/, '.grade.json');
}

export function resolveBatchDir(input: string): string {
  // Accept absolute path, relative path, or just a batch basename.
  if (existsSync(input)) return input;
  const root = runsRoot();
  const candidate = join(root, input);
  if (existsSync(candidate)) return candidate;
  // Allow user to drop the bare basename even if not yet present.
  return dirname(input) === '.' ? candidate : input;
}
