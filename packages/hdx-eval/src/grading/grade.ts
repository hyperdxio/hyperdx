import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { RunRecord } from '@/harness/types';
import { isModelSubdir, isRunJson, runsRoot, safeReaddir } from '@/runs/path';
import { readRun } from '@/runs/store';
import { getScenario, SCENARIO_NAMES } from '@/scenarios';
import type { PostRunInspectionResult } from '@/scenarios/types';

import type { BlindingEntry } from './blind';
import { judgeTrajectory } from './judge';
import { runProgrammaticChecks } from './programmatic';
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
  judgeModel?: string;
  rerunJudge?: boolean;
  skipJudge?: boolean;
  apiKey?: string;
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

  // Decide whether we'll actually need the judge: skipJudge wins, otherwise
  // we need it if any run is missing a cached judge OR rerun was requested.
  const needsJudge =
    !opts.skipJudge &&
    runFiles.some(p => {
      if (opts.rerunJudge) return true;
      const existing = readExistingGrade(gradeFilePath(p));
      return !existing?.judge;
    });

  if (needsJudge && !opts.apiKey && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set; pass --no-judge to skip the LLM judge ' +
        'or supply a key via env.',
    );
  }

  const client = needsJudge
    ? new Anthropic({
        apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
      })
    : undefined;
  const graded: GradeRecord[] = [];
  const errors: { runPath: string; error: string }[] = [];

  for (const runPath of runFiles) {
    try {
      const record = readRun(runPath);
      const gradePath = gradeFilePath(runPath);
      const existing = readExistingGrade(gradePath);

      const grade = await gradeOne({
        record,
        client,
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
      // Show inspection summary if present.
      const inspBit = grade.inspectionSummary
        ? formatInspectionLogBit(grade.inspectionSummary)
        : '';
      console.log(
        `  ${grade.scenario}/${grade.mcp}/${grade.runId.split('-').slice(-1)[0]}  prog=${(
          grade.programmatic.score * 100
        ).toFixed(
          0,
        )}%  ${judgeBit}  combined=${(grade.combinedScore * 100).toFixed(0)}%${errBit}${inspBit}`,
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
  client?: Anthropic;
  existing: GradeRecord | null;
  opts: GradeBatchOptions;
}): Promise<GradeRecord> {
  const { record, client, existing, opts } = args;
  const scenario = getScenario(record.scenario);
  const rubric = loadScenarioRubric(record.scenario);

  const programmatic = runProgrammaticChecks(
    record.finalAnswer,
    rubric.programmatic,
  );

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
  let judge: JudgeResult | null = existing?.judge ?? null;
  if (!opts.skipJudge && client && (!judge || opts.rerunJudge)) {
    judge = await judgeTrajectory({
      scenarioName: scenario.name,
      scenarioPrompt: scenario.agentPrompt,
      groundTruth: scenario.groundTruth,
      rubric,
      finalAnswer: record.finalAnswer,
      judgeModel: opts.judgeModel,
      client,
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
    judge,
    toolErrors,
    inspectionSummary: inspectionResult?.summary,
    inspectionEvidence: inspectionResult?.evidence || undefined,
    combinedScore,
    gradedAt: new Date().toISOString(),
    judgeModel: judge?.model ?? opts.judgeModel ?? 'skipped',
  };
}

/**
 * List run JSON files. Supports both the new
 * `<scenario>/<mcp>/<model>/<index>.json` layout and the legacy
 * `<scenario>/<mcp>/<index>.json` layout.
 */
function listRunFiles(batchDir: string): string[] {
  const out: string[] = [];
  for (const scenario of safeReaddir(batchDir)) {
    if (!SCENARIO_NAMES.includes(scenario)) continue;
    const sceneDir = join(batchDir, scenario);
    for (const mcp of safeReaddir(sceneDir)) {
      const mcpDir = join(sceneDir, mcp);
      for (const entry of safeReaddir(mcpDir)) {
        if (isRunJson(entry)) {
          // Legacy layout: <scenario>/<mcp>/<index>.json
          out.push(join(mcpDir, entry));
        } else if (isModelSubdir(mcpDir, entry)) {
          // New layout: <scenario>/<mcp>/<model>/<index>.json
          const modelDir = join(mcpDir, entry);
          for (const file of safeReaddir(modelDir)) {
            if (isRunJson(file)) out.push(join(modelDir, file));
          }
        }
      }
    }
  }
  return out.sort();
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
