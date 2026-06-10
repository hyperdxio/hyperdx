import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { RunRecord } from '../harness/types';
import {
  isModelSubdir,
  isRunJson,
  runFilePath,
  runsRoot,
  safeReaddir,
} from './path';

export function writeRun(args: {
  record: RunRecord;
  batchDir: string;
}): string {
  const path = runFilePath({
    batchDir: args.batchDir,
    scenario: args.record.scenario,
    mcp: args.record.mcp,
    model: args.record.model,
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

/**
 * List run JSON files in a batch.  Supports both the new
 * `<scenario>/<mcp>/<model>/<index>.json` layout and the legacy
 * `<scenario>/<mcp>/<index>.json` layout (for batches created before
 * the multi-model feature).
 */
export function listRunsInBatch(batchDir: string): string[] {
  const root = join(runsRoot(), batchDir);
  const out: string[] = [];
  for (const scenario of safeReaddir(root)) {
    const sceneDir = join(root, scenario);
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
            if (isRunJson(file)) {
              out.push(join(modelDir, file));
            }
          }
        }
      }
    }
  }
  return out.sort();
}
