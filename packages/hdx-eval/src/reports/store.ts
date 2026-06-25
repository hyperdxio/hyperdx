import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { GradeRecord } from '@/grading/types';
import type { McpKind, RunRecord } from '@/harness/types';
import { isModelSubdir, isRunJson, safeReaddir } from '@/runs/path';
import { SCENARIO_NAMES } from '@/scenarios';

import { buildAggregate, type GradedRunPair } from './aggregate';
import { renderMarkdownReport } from './markdown';

function collectRunGradePairs(dir: string, pairs: GradedRunPair[]): void {
  for (const file of safeReaddir(dir)) {
    if (isRunJson(file)) {
      const runPath = join(dir, file);
      const gradePath = runPath.replace(/\.json$/, '.grade.json');
      if (!existsSync(gradePath)) continue;
      try {
        const run = JSON.parse(readFileSync(runPath, 'utf8')) as RunRecord;
        const grade = JSON.parse(
          readFileSync(gradePath, 'utf8'),
        ) as GradeRecord;
        pairs.push({ run, grade });
      } catch {
        // skip malformed
      }
    }
  }
}

/**
 * Load graded pairs from a batch. Supports both the new
 * `<scenario>/<mcp>/<model>/<index>.json` layout and the legacy
 * `<scenario>/<mcp>/<index>.json` layout.
 */
function loadGradedPairs(batchDir: string): GradedRunPair[] {
  const pairs: GradedRunPair[] = [];
  for (const scenario of safeReaddir(batchDir)) {
    if (!SCENARIO_NAMES.includes(scenario)) continue;
    const sceneDir = join(batchDir, scenario);
    for (const mcp of safeReaddir(sceneDir)) {
      const mcpDir = join(sceneDir, mcp);
      // Collect runs directly in mcpDir (legacy layout).
      collectRunGradePairs(mcpDir, pairs);
      // Also check subdirectories (new model layout).
      for (const entry of safeReaddir(mcpDir)) {
        if (isModelSubdir(mcpDir, entry)) {
          collectRunGradePairs(join(mcpDir, entry), pairs);
        }
      }
    }
  }
  return pairs;
}

export function writeBatchSummary(
  batchDir: string,
  outPath: string,
  baseline?: McpKind,
): { jsonPath: string; mdPath: string; pairsCount: number } {
  const pairs = loadGradedPairs(batchDir);
  const summary = buildAggregate({ batchDir, pairs, baseline });

  const jsonPath = outPath.replace(/\.md$/, '.json');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  const md = renderMarkdownReport(summary);
  writeFileSync(outPath, md, 'utf8');

  return { jsonPath, mdPath: outPath, pairsCount: pairs.length };
}
