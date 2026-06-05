import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { RunRecord } from '../harness/types';
import { runsRoot } from '../runs/path';
import { readRun } from '../runs/store';
import { getScenario, SCENARIO_NAMES } from '../scenarios';
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
      console.log(
        `  ${grade.scenario}/${grade.mcp}/${grade.runId.split('-').slice(-1)[0]}  prog=${(
          grade.programmatic.score * 100
        ).toFixed(
          0,
        )}%  ${judgeBit}  combined=${(grade.combinedScore * 100).toFixed(0)}%${errBit}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ runPath, error: msg });
      console.error(`  ${runPath}: ${msg}`);
    }
  }

  return { batchDir: resolved, graded, errors };
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
    });
  }

  const judgeError = judge && 'error' in judge && judge.error;
  const judgeScore = judge?.weightedScore ?? 0;
  const rawCombined =
    judge && !judgeError
      ? COMBINED_SCORE_PROGRAMMATIC_WEIGHT * programmatic.score +
        COMBINED_SCORE_JUDGE_WEIGHT * judgeScore
      : programmatic.score;
  const toolErrors = computeToolErrorStats(record);
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
    combinedScore,
    gradedAt: new Date().toISOString(),
    judgeModel: judge?.model ?? opts.judgeModel ?? 'skipped',
  };
}

function listRunFiles(batchDir: string): string[] {
  const out: string[] = [];
  for (const scenario of safeReaddir(batchDir)) {
    if (!SCENARIO_NAMES.includes(scenario)) continue;
    const sceneDir = join(batchDir, scenario);
    for (const mcp of safeReaddir(sceneDir)) {
      const mcpDir = join(sceneDir, mcp);
      for (const file of safeReaddir(mcpDir)) {
        if (file.endsWith('.grade.json')) continue;
        if (file.endsWith('.timing.json')) continue;
        if (file.endsWith('.json')) out.push(join(mcpDir, file));
      }
    }
  }
  return out.sort();
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
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
