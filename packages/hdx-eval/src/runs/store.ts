import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { RunRecord } from '../harness/types';
import { runFilePath, runsRoot } from './path';

export function writeRun(args: {
  record: RunRecord;
  batchDir: string;
}): string {
  const path = runFilePath({
    batchDir: args.batchDir,
    scenario: args.record.scenario,
    mcp: args.record.mcp,
    runIndex: args.record.runIndex,
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(args.record, null, 2) + '\n', 'utf8');
  return path;
}

export function readRun(path: string): RunRecord {
  return JSON.parse(readFileSync(path, 'utf8')) as RunRecord;
}

export function listBatches(): string[] {
  try {
    return readdirSync(runsRoot()).sort();
  } catch {
    return [];
  }
}

export function listRunsInBatch(batchDir: string): string[] {
  const root = join(runsRoot(), batchDir);
  const out: string[] = [];
  try {
    for (const scenario of readdirSync(root)) {
      const sceneDir = join(root, scenario);
      try {
        for (const mcp of readdirSync(sceneDir)) {
          const mcpDir = join(sceneDir, mcp);
          try {
            for (const file of readdirSync(mcpDir)) {
              if (file.endsWith('.json')) out.push(join(mcpDir, file));
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // none
  }
  return out.sort();
}
