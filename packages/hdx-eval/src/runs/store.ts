import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { RunRecord } from '@/harness/types';

import { getRunFilesInBatch, runFilePath, runsRoot } from './path';

export function writeRun(args: {
  record: RunRecord;
  batchDir: string;
}): string {
  const path = runFilePath({
    batchDir: args.batchDir,
    scenario: args.record.scenario,
    mcp: args.record.mcp,
    model: args.record.model,
    plugin: args.record.plugin,
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

/** List run JSON files in a batch. See `getRunFilesInBatch` for the layouts. */
export function listRunsInBatch(batchDir: string): string[] {
  return getRunFilesInBatch(join(runsRoot(), batchDir));
}
