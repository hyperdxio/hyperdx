import { readdirSync, statSync } from 'fs';
import { resolve } from 'path';

import type { McpKind } from '../harness/types';

export function runsRoot(): string {
  return resolve(__dirname, '..', '..', 'runs');
}

export function batchDirName(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Sanitize a model ID for use as a directory name. Replaces characters
 * that are problematic in file paths (`:`, `/`, `\`, `.`) with dashes.
 *
 * Dots are replaced to avoid confusion with file extensions when listing
 * directory entries alongside run files like `0.json`.
 */
export function modelDirName(model: string): string {
  return model.replace(/[:/\\.]/g, '-');
}

export function runFilePath(args: {
  batchDir: string;
  scenario: string;
  mcp: McpKind;
  model: string;
  runIndex: number;
}): string {
  return resolve(
    runsRoot(),
    args.batchDir,
    args.scenario,
    args.mcp,
    modelDirName(args.model),
    `${args.runIndex}.json`,
  );
}

// ---------------------------------------------------------------------------
// Shared filesystem helpers — used by store, instrument, grade, reports, and
// the viewer. Centralised here to avoid duplication.
// ---------------------------------------------------------------------------

/**
 * Returns true if `file` is a numeric-indexed run JSON filename (e.g.
 * `0.json`, `12.json`). Excludes sidecar files (`.grade.json`,
 * `.timing.json`) and any other non-run JSON by requiring the `^\d+\.json$`
 * pattern.
 */
export function isRunJson(file: string): boolean {
  return /^\d+\.json$/.test(file);
}

/**
 * Like `readdirSync` but returns `[]` on any error (missing dir, permission
 * issues, etc.).
 */
export function safeReaddir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

/**
 * Returns true when `entry` inside `parentDir` is a subdirectory (i.e. a
 * model directory in the new layout), as opposed to a file. Uses `stat`
 * instead of a heuristic so model names containing dots are handled
 * correctly.
 */
export function isModelSubdir(parentDir: string, entry: string): boolean {
  try {
    return statSync(resolve(parentDir, entry)).isDirectory();
  } catch {
    return false;
  }
}
