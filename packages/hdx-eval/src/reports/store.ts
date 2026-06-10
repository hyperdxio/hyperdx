import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { GradeRecord } from '../grading/types';
import type { McpKind, RunRecord } from '../harness/types';
import { SCENARIO_NAMES } from '../scenarios';
import { buildAggregate, type GradedRunPair } from './aggregate';
import { renderMarkdownReport } from './markdown';

function loadGradedPairs(batchDir: string): GradedRunPair[] {
  const pairs: GradedRunPair[] = [];
  for (const scenario of safeReaddir(batchDir)) {
    if (!SCENARIO_NAMES.includes(scenario)) continue;
    const sceneDir = join(batchDir, scenario);
    for (const mcp of safeReaddir(sceneDir)) {
      const mcpDir = join(sceneDir, mcp);
      for (const file of safeReaddir(mcpDir)) {
        if (!file.endsWith('.json')) continue;
        if (file.endsWith('.grade.json')) continue;
        const runPath = join(mcpDir, file);
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

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
