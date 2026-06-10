import { resolve } from 'path';

import type { McpKind } from '../harness/types';

export function runsRoot(): string {
  return resolve(__dirname, '..', '..', 'runs');
}

export function batchDirName(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function runFilePath(args: {
  batchDir: string;
  scenario: string;
  mcp: McpKind;
  runIndex: number;
}): string {
  return resolve(
    runsRoot(),
    args.batchDir,
    args.scenario,
    args.mcp,
    `${args.runIndex}.json`,
  );
}
