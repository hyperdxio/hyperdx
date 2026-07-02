import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { GradeRecord } from '@/grading/types';
import type { RunRecord } from '@/harness/types';
import { getRunFilesInBatch } from '@/runs/path';
import { SCENARIO_NAMES } from '@/scenarios';

import {
  buildAggregate,
  type ColumnKey,
  type GradedRunPair,
} from './aggregate';
import { renderMarkdownReport } from './markdown';

/**
 * Load graded pairs from a batch: every run JSON (see `getRunFilesInBatch` for
 * the supported layouts) that has a `.grade.json` sidecar next to it.
 */
function loadGradedPairs(batchDir: string): GradedRunPair[] {
  const pairs: GradedRunPair[] = [];
  const runPaths = getRunFilesInBatch(batchDir, {
    scenarioFilter: s => SCENARIO_NAMES.includes(s),
  });
  for (const runPath of runPaths) {
    const gradePath = runPath.replace(/\.json$/, '.grade.json');
    if (!existsSync(gradePath)) continue;
    try {
      const run = JSON.parse(readFileSync(runPath, 'utf8')) as RunRecord;
      const grade = JSON.parse(readFileSync(gradePath, 'utf8')) as GradeRecord;
      pairs.push({ run, grade });
    } catch {
      // skip malformed
    }
  }
  return pairs;
}

/**
 * Baseline recorded by a previous report at the batch's canonical
 * `_summary.json`, if any. Lets `report` regenerations keep the baseline the
 * `run` auto-report chose (CLI variant order), which `buildAggregate` cannot
 * reconstruct from the run data alone.
 */
function persistedBaseline(batchDir: string): ColumnKey | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(join(batchDir, '_summary.json'), 'utf8'),
    ) as { baseline?: unknown };
    return typeof raw.baseline === 'string' ? raw.baseline : undefined;
  } catch {
    return undefined;
  }
}

export function writeBatchSummary(
  batchDir: string,
  outPath: string,
  baseline?: ColumnKey,
): { jsonPath: string; mdPath: string; pairsCount: number } {
  const pairs = loadGradedPairs(batchDir);
  const summary = buildAggregate({
    batchDir,
    pairs,
    baseline: baseline ?? persistedBaseline(batchDir),
  });

  const jsonPath = outPath.replace(/\.md$/, '.json');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  const md = renderMarkdownReport(summary);
  writeFileSync(outPath, md, 'utf8');

  return { jsonPath, mdPath: outPath, pairsCount: pairs.length };
}
