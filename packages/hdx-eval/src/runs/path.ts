import { readdirSync, statSync } from 'fs';
import { resolve } from 'path';

import { type McpKind, PLUGIN_NONE } from '@/harness/types';

export function runsRoot(): string {
  return resolve(__dirname, '..', '..', 'runs');
}

export function batchDirName(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Sanitize a model ID or plugin name for use as a directory name. Replaces
 * characters that are problematic in file paths (`:`, `/`, `\`, `.`) with
 * dashes.
 *
 * Dots are replaced to avoid confusion with file extensions when listing
 * directory entries alongside run files like `0.json`.
 */
export function escapeDirSegment(segment: string): string {
  return segment.replace(/[:/\\.]/g, '-');
}

/**
 * Path of a run JSON file: `<batch>/<scenario>/<mcp>/<model>/<plugin>/<i>.json`.
 * Model and plugin are treated consistently — each always gets a directory
 * level, with the no-plugin arm stored under the literal `none` directory.
 */
export function runFilePath(args: {
  batchDir: string;
  scenario: string;
  mcp: McpKind;
  model: string;
  plugin?: string;
  runIndex: number;
}): string {
  return resolve(
    runsRoot(),
    args.batchDir,
    args.scenario,
    args.mcp,
    escapeDirSegment(args.model),
    escapeDirSegment(args.plugin || PLUGIN_NONE),
    `${args.runIndex}.json`,
  );
}

// ---------------------------------------------------------------------------
// Batch walking — `getRunFilesInBatch` is the single walker used by store,
// instrument, grade, and reports. (The viewer keeps its own plain-JS copy
// because it needs cell grouping rather than a flat file list.)
// ---------------------------------------------------------------------------

/**
 * Returns true if `file` is a numeric-indexed run JSON filename (e.g.
 * `0.json`, `12.json`). Excludes sidecar files (`.grade.json`,
 * `.timing.json`) and any other non-run JSON by requiring the `^\d+\.json$`
 * pattern.
 */
function isRunJson(file: string): boolean {
  return /^\d+\.json$/.test(file);
}

/**
 * Like `readdirSync` but returns `[]` on any error (missing dir, permission
 * issues, etc.).
 */
function safeReaddir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

/**
 * Returns true when `entry` inside `parentDir` is a subdirectory, as opposed
 * to a file. Uses `stat` instead of a heuristic so model names containing
 * dots are handled correctly.
 */
function isModelSubdir(parentDir: string, entry: string): boolean {
  try {
    return statSync(resolve(parentDir, entry)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Absolute paths of the run JSON files under a model directory: those one
 * level deeper in per-plugin subdirectories (`<model>/<plugin>/<index>.json`,
 * with the no-plugin arm under `<model>/none/`) plus those directly in
 * `modelDir` (legacy batches created before the plugin level was always
 * emitted).
 */
function getRunFilesInModelDir(modelDir: string): string[] {
  const out: string[] = [];
  for (const entry of safeReaddir(modelDir)) {
    if (isRunJson(entry)) {
      // Legacy no-plugin arm: <model>/<index>.json
      out.push(resolve(modelDir, entry));
    } else if (isModelSubdir(modelDir, entry)) {
      // Plugin arm (incl. `none`): <model>/<plugin>/<index>.json
      const pluginDir = resolve(modelDir, entry);
      for (const file of safeReaddir(pluginDir)) {
        if (isRunJson(file)) out.push(resolve(pluginDir, file));
      }
    }
  }
  return out;
}

/**
 * Absolute paths of all run JSON files in a batch directory, sorted. Handles
 * the current `<scenario>/<mcp>/<model>/<plugin>/<index>.json` layout (the
 * no-plugin arm lives under `<model>/none/`) plus two legacy layouts: runs
 * directly in the model dir (pre-plugin-level) and directly in the mcp dir
 * (pre-multi-model). Sidecar files (`.grade.json`, `.timing.json`) are
 * excluded. Pass `scenarioFilter` to restrict which top-level scenario
 * directories are walked.
 */
export function getRunFilesInBatch(
  batchRoot: string,
  opts: { scenarioFilter?: (name: string) => boolean } = {},
): string[] {
  const out: string[] = [];
  for (const scenario of safeReaddir(batchRoot)) {
    if (opts.scenarioFilter && !opts.scenarioFilter(scenario)) continue;
    const sceneDir = resolve(batchRoot, scenario);
    for (const mcp of safeReaddir(sceneDir)) {
      const mcpDir = resolve(sceneDir, mcp);
      for (const entry of safeReaddir(mcpDir)) {
        if (isRunJson(entry)) {
          // Legacy layout: <scenario>/<mcp>/<index>.json
          out.push(resolve(mcpDir, entry));
        } else if (isModelSubdir(mcpDir, entry)) {
          out.push(...getRunFilesInModelDir(resolve(mcpDir, entry)));
        }
      }
    }
  }
  return out.sort();
}
